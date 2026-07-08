// pattern: Imperative Shell — agent loop with execute_code dispatch

import { createHash } from 'node:crypto';
import type {
  Message,
  ToolUseBlock,
  ToolResultBlock,
  ToolResultContentBlock,
  ToolDefinition,
  ContentBlock,
} from '../model/types.ts';
import { ModelError } from '../model/types.ts';
import type { Agent, AgentDependencies, ChatContext, ChatImage, ChatResult, ChatStats, ChatOptions, AgentEventKind, RecalledContextEntry } from './types.ts';
import { estimateTokens, estimateMessagesTokens, repairConversation, trimOldToolResults } from './context.ts';
import { log } from '../util/log.ts';
import { buildSystemPromptParts, type SystemPromptParts } from './prompt.ts';
import { needsCompaction, exceedsTokenBudget, compactContext } from './compaction.ts';
import { createAgentTools } from './tools.ts';
import { maybeGenerateSessionTitle } from './session-title.ts';
import { performRecall } from '../recall/index.ts';

function quickHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

const EXECUTE_CODE_TOOL: ToolDefinition = {
  name: 'execute_code',
  description: `Run TypeScript in a sandboxed Deno runtime. This is the ONLY way to invoke any tool — every operation (documents, skills, search, scheduling) goes through code you submit here.

The \`tools\` namespace and \`output\`/\`debug\` helpers are already imported — do NOT write import statements.

Call tool functions as \`await tools.<name>({...})\`:
  await tools.doc_upsert({ rkey: "operator", content: "# About the user\\n..." })
  const doc = await tools.doc_get({ rkey: "self" })
  const results = await tools.doc_search({ query: "meetings", limit: 3 })
  await tools.doc_list({})
  await tools.run_skill({ name: "exa-news-search", args: ["AI news"] })
  await tools.schedule_task({ name: "news", prompt: "Search for latest news and write a briefing", schedule: "6h" })
  await tools.cancel_task({ id: "abc123" })

Use output(value) to return a result. Use debug(msg) to log.

Example — list documents then save a new one:
  const docs = await tools.doc_list({});
  await tools.doc_upsert({ rkey: "task:research", content: "# Research Progress\\n..." });
  output({ docs, status: "done" });

Full tool reference with all available functions and their parameters is in your system prompt.`,
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'TypeScript code to execute. Has access to all tool functions and output()/debug() helpers.' },
    },
    required: ['code'],
  },
};

export function formatNativeToolResult(
  toolUseId: string,
  result: unknown,
): ToolResultBlock {
  if (typeof result === 'string') {
    return { type: 'tool_result', tool_use_id: toolUseId, content: result };
  }

  if (
    result !== null &&
    typeof result === 'object' &&
    'type' in result &&
    (result as Record<string, unknown>).type === 'image_result'
  ) {
    const r = result as Record<string, unknown>;
    const blocks: Array<ToolResultContentBlock> = [];

    if (typeof r.text === 'string') {
      blocks.push({ type: 'text', text: r.text });
    }

    if (r.image && typeof r.image === 'object') {
      const img = r.image as Record<string, unknown>;
      if (typeof img.data === 'string' && typeof img.media_type === 'string') {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type, data: img.data },
        });
      }
    }

    if (blocks.length > 0) {
      return { type: 'tool_result', tool_use_id: toolUseId, content: blocks };
    }
  }

  const serialized = typeof result === 'undefined' ? '(no output)' : JSON.stringify(result);
  return { type: 'tool_result', tool_use_id: toolUseId, content: serialized };
}

/**
 * Append the current user message to a compacted history, folding it into
 * the trailing compaction message when both are user-role. The API-facing
 * history must alternate roles — two consecutive user messages are rejected
 * by Anthropic.
 */
export function mergeUserMessages(
  compacted: ReadonlyArray<Message>,
  current: Message | undefined,
): Array<Message> {
  if (!current) return [...compacted];

  const last = compacted[compacted.length - 1];
  if (!last || last.role !== 'user' || current.role !== 'user') {
    return [...compacted, current];
  }

  const toBlocks = (content: Message['content']): Array<ContentBlock> =>
    typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];

  if (typeof last.content === 'string' && typeof current.content === 'string') {
    return [
      ...compacted.slice(0, -1),
      { role: 'user', content: last.content + '\n\n' + current.content },
    ];
  }

  return [
    ...compacted.slice(0, -1),
    { role: 'user', content: [...toBlocks(last.content), ...toBlocks(current.content)] },
  ];
}

export function createAgent(deps: Readonly<AgentDependencies>): Agent {
  let history: Array<Message> = [];
  let currentContext: ChatContext = {};

  // Serialize chat() calls per conversation, not globally. Calls with a
  // conversationOverride operate on their own message array keyed by
  // sessionId; calls without one share the agent-level history and are
  // serialized under a single shared key. A slow scheduled task therefore
  // no longer blocks unrelated Discord channels.
  const chatLocks = new Map<string, Promise<void>>();

  async function chat(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    const lockKey = options?.conversationOverride !== undefined
      ? `session:${options?.sessionId ?? 'default'}`
      : 'shared';

    const prevLock = chatLocks.get(lockKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const nextLock = new Promise<void>((r) => { releaseLock = r; });
    chatLocks.set(lockKey, nextLock);

    await prevLock;
    try {
      return await _chatImpl(userMessage, options);
    } finally {
      releaseLock();
      if (chatLocks.get(lockKey) === nextLock) {
        chatLocks.delete(lockKey);
      }
    }
  }

  async function _chatImpl(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    const chatStart = performance.now();
    const emit = async (kind: AgentEventKind, data: Record<string, unknown>): Promise<void> => {
      if (!options?.onEvent) return;
      try {
        await options.onEvent({ kind, data });
      } catch (err) {
        log(`[agent] event callback error (${kind}): ${err}`);
      }
    };
    currentContext = options?.context ?? {};
    const images = options?.images;

    // Work on a per-call message array. With a conversationOverride we copy
    // the caller's history; otherwise we operate on the shared agent history
    // (serialized by the 'shared' chat lock).
    const usesSharedHistory = options?.conversationOverride === undefined;
    let msgs: Array<Message> = usesSharedHistory
      ? history
      : [...(options?.conversationOverride ?? [])];

    try {

    // Create tool registry (fresh each call — context may change)
    const registry = createAgentTools(deps, currentContext);

    // Generate TypeScript stubs for the Deno sandbox (passed to executor per-execution)
    const stubsCode = registry.generateTypeScriptStubs();

    // Generate tool docs for system prompt
    const toolDocs = registry.generateToolDocumentation();

    // Native tools that the model invokes directly (not through execute_code)
    const nativeTools = registry.generateToolDefinitions();

    // Track cumulative stats across rounds
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;
    let rounds = 0;

    // d. Append user message
    if (images && images.length > 0) {
      const blocks: ContentBlock[] = [
        { type: 'text', text: userMessage },
        ...images.map(img => ({ type: 'image_url' as const, image_url: { url: img.url } })),
      ];
      msgs.push({ role: 'user', content: blocks });
    } else {
      msgs.push({ role: 'user', content: userMessage });
    }

    // d.1 Repair any orphaned tool_use blocks from previous crashes
    const repairedCount = repairConversation(msgs);
    if (repairedCount > 0) {
      log(`[agent] Repaired ${repairedCount} orphaned tool_use block(s)`);
    }

    // d.2 Trim verbose tool results in older messages
    trimOldToolResults(msgs);

    // Recall step — runs before the compaction check so the recalled
    // context is part of the measured system prompt
    let recalledContext: ReadonlyArray<RecalledContextEntry> | undefined;
    if (deps.config.recallEnabled) {
      const recallResult = await performRecall(userMessage, {
        store: deps.store,
        embedding: deps.embedding,
        subAgent: deps.subAgent,
        tokenBudget: deps.config.recallTokenBudget,
      });
      if (recallResult) {
        recalledContext = recallResult.fragments.map(f => ({ rkey: f.rkey, content: f.content }));
        await emit('recall_done', {
          elapsed: recallResult.elapsed,
          fragmentCount: recallResult.fragments.length,
          totalTokens: recallResult.totalTokens,
        });
      } else {
        await emit('recall_done', { elapsed: 0, fragmentCount: 0, totalTokens: 0 });
      }
    }

    // Build system prompt — track selfDoc hash to detect changes during tool loop
    let selfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
    let selfDocHash = quickHash(selfDoc);
    const skillNames = deps.store.docListByPrefix('skill:').map(d => d.rkey);

    const customToolSummaries = deps.customTools
      ? deps.customTools.getApprovedToolSummaries()
      : undefined;

    const secretNames = deps.secrets
      ? deps.secrets.listKeys()
      : undefined;

    let promptParts: SystemPromptParts = buildSystemPromptParts({
      selfDoc,
      skillNames,
      toolDocs,
      timezone: deps.config.timezone,
      recalledContext,
      customToolSummaries,
      secretNames,
      nativeToolNames: nativeTools.map(t => t.name),
    });
    const fullSystemPrompt = (): string => promptParts.stable + '\n' + promptParts.volatile;

    // Handle context overflow via compaction — measured against the real
    // system prompt (self doc + tool docs + recall), not an empty string
    if (needsCompaction(msgs, fullSystemPrompt(), deps.config.contextLimit, deps.config.contextBudget)) {
      if (!deps.subAgent) throw new Error('subAgent required for compaction');
      const compacted = await compactContext(msgs, {
        store: deps.store,
        subAgent: deps.subAgent,
        sessionId: options?.sessionId,
      });
      // Merge the compaction summary into the current user message so the
      // conversation never contains consecutive user-role messages
      // (Anthropic rejects non-alternating roles).
      const currentMessage = msgs[msgs.length - 1];
      msgs = mergeUserMessages(compacted, currentMessage);
    }

    // e. Tool loop
    let exitedNormally = false;
    for (let round = 0; round < deps.config.maxToolRounds; round++) {
      // Check if selfDoc was modified by tool execution — rebuild prompt if so
      if (round > 0) {
        const currentSelfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
        const currentHash = quickHash(currentSelfDoc);
        if (currentHash !== selfDocHash) {
          selfDoc = currentSelfDoc;
          selfDocHash = currentHash;
          promptParts = buildSystemPromptParts({
            selfDoc,
            skillNames,
            toolDocs,
            timezone: deps.config.timezone,
            recalledContext,
            customToolSummaries,
            secretNames,
            nativeToolNames: nativeTools.map(t => t.name),
          });
          log('[agent] selfDoc changed during tool loop, rebuilt system prompt');
        }
      }

      let response;
      try {
        await emit('llm_start', { round });
        response = await deps.model.complete({
          system: promptParts.stable,
          system_suffix: promptParts.volatile,
          messages: msgs,
          tools: [EXECUTE_CODE_TOOL, ...nativeTools],
          model: deps.config.model,
          max_tokens: deps.config.maxTokens,
          temperature: deps.config.temperature,
          timeout: deps.config.modelTimeout,
        });
      } catch (err) {
        // Model call failed — re-throw with context. ModelError preserves kind/retryable.
        if (err instanceof ModelError) {
          log(`[agent] model error (${err.kind}): ${err.message}`);
          throw err;
        }
        throw new Error(`Model call failed: ${err instanceof Error ? err.message : err}`);
      }

      // Accumulate usage stats
      rounds++;
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      totalCacheCreation += response.usage.cache_creation_input_tokens ?? 0;
      totalCacheRead += response.usage.cache_read_input_tokens ?? 0;

      if (response.usage.cache_read_input_tokens || response.usage.cache_creation_input_tokens) {
        const hitRatio = response.usage.input_tokens > 0
          ? ((response.usage.cache_read_input_tokens ?? 0) / response.usage.input_tokens * 100).toFixed(1)
          : '0.0';
        log(`[agent] cache: read=${response.usage.cache_read_input_tokens ?? 0} created=${response.usage.cache_creation_input_tokens ?? 0} hit=${hitRatio}%`);
      }

      await emit('llm_done', { round, usage: response.usage, stop_reason: response.stop_reason });

      const toolBlocks = response.content.filter(b => b.type === 'tool_use').length;
      const textBlocks = response.content.filter(b => b.type === 'text').length;
      log(`[agent] round=${round} stop_reason=${response.stop_reason} content_blocks=${response.content.length} tool_use=${toolBlocks} text=${textBlocks}`);

      // Append assistant response
      const assistantMessage: Message = { role: 'assistant', content: response.content };
      if (response.reasoning_content) {
        assistantMessage.reasoning_content = response.reasoning_content;
      }
      msgs.push(assistantMessage);

      // Check stop reason
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        log(`[agent] loop exiting: ${response.stop_reason}`);
        exitedNormally = true;
        break;
      }

      // Dispatch tool calls via execute_code → registry
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use',
        );

        // All tool calls had parse errors — no actual tool_use blocks to dispatch.
        // The error text blocks are already in the assistant message, so just
        // continue to the next round and let the model see them and retry.
        if (toolUseBlocks.length === 0) {
          continue;
        }

        try {
          const toolResults: Array<ToolResultBlock> = await Promise.all(
            toolUseBlocks.map(async (block): Promise<ToolResultBlock> => {
              try {
                if (block.name === 'execute_code') {
                  const code = (block.input as Record<string, unknown>)['code'];
                  if (typeof code !== 'string') {
                    return { type: 'tool_result', tool_use_id: block.id, content: 'Error: missing code parameter', is_error: true };
                  }

                  await emit('tool_start', { tool: 'execute_code', code: code.slice(0, 500) });

                  // IPC callback: dispatch tool calls from the sandbox through the registry
                  const onToolCall = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
                    return registry.execute(name, params);
                  };

                  const result = await deps.runtime.execute(code, undefined, onToolCall, stubsCode);
                  await emit('tool_done', { tool: 'execute_code', success: result.success, preview: (result.output ?? '').slice(0, 200) });
                  const output = result.success
                    ? result.output || '(no output)'
                    : `Error: ${result.error ?? 'unknown error'}\n${result.output}`;
                  return { type: 'tool_result', tool_use_id: block.id, content: output, is_error: !result.success };
                } else {
                  const result = await registry.execute(block.name, block.input);
                  return formatNativeToolResult(block.id, result);
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { type: 'tool_result', tool_use_id: block.id, content: `Tool error: ${message}`, is_error: true };
              }
            }),
          );

          // Append tool results as user message
          msgs.push({ role: 'user', content: toolResults });

          // Check for pending messages between tool rounds
          if (options?.shouldInterrupt?.()) {
            log('[agent] interrupted by pending message, exiting tool loop');
            exitedNormally = true;
            break;
          }

          // Mid-loop context guard: the API reported the true prompt size
          // for this round — if the loop has grown past the budget, trim
          // aggressively and compact before the next model call.
          const budgetThreshold = Math.floor(deps.config.contextBudget * deps.config.contextLimit);
          if (exceedsTokenBudget(response.usage.input_tokens, budgetThreshold)) {
            log(`[agent] mid-loop context at ${response.usage.input_tokens} tokens (budget ${budgetThreshold}), compacting`);
            trimOldToolResults(msgs, { preserveCount: 4 });
            if (deps.subAgent) {
              msgs = await compactContext(msgs, {
                store: deps.store,
                subAgent: deps.subAgent,
                sessionId: options?.sessionId,
              });
            }
          }
        } catch (err) {
          // Tool dispatch crashed — assistant message with tool_use is in history
          // but no tool_result. repairConversation will fix this next call.
          throw new Error(`Tool dispatch failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // g. Handle max-iteration exhaustion — force a text-only wrap-up.
    // Tools stay in the request with tool_choice 'none': Anthropic rejects
    // histories containing tool_use blocks when no tools are defined.
    if (!exitedNormally) {
      log(`[agent] max tool rounds (${deps.config.maxToolRounds}) exhausted, forcing final response`);

      msgs.push({
        role: 'user',
        content: '[System: Max tool calls reached. Provide final response now.]',
      });

      await emit('llm_start', { round: rounds, forced: true });
      const finalResponse = await deps.model.complete({
        system: promptParts.stable,
        system_suffix: promptParts.volatile,
        messages: msgs,
        tools: [EXECUTE_CODE_TOOL, ...nativeTools],
        tool_choice: 'none',
        model: deps.config.model,
        max_tokens: deps.config.maxTokens,
        temperature: deps.config.temperature,
        timeout: deps.config.modelTimeout,
      });

      rounds++;
      totalInputTokens += finalResponse.usage.input_tokens;
      totalOutputTokens += finalResponse.usage.output_tokens;
      totalCacheCreation += finalResponse.usage.cache_creation_input_tokens ?? 0;
      totalCacheRead += finalResponse.usage.cache_read_input_tokens ?? 0;

      await emit('llm_done', {
        round: rounds - 1,
        usage: finalResponse.usage,
        stop_reason: finalResponse.stop_reason,
        forced: true,
      });

      const finalAssistantMsg: Message = { role: 'assistant', content: finalResponse.content };
      if (finalResponse.reasoning_content) {
        finalAssistantMsg.reasoning_content = finalResponse.reasoning_content;
      }
      msgs.push(finalAssistantMsg);
    }

    // f. Extract final text from last assistant message
    const lastAssistant = msgs.findLast((msg) => msg.role === 'assistant');
    const durationMs = Math.round(performance.now() - chatStart);

    // Estimate current context size
    const contextEstimate = estimateTokens(fullSystemPrompt()) + estimateMessagesTokens(msgs);

    const stats: ChatStats = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheCreationTokens: totalCacheCreation,
      cacheReadTokens: totalCacheRead,
      contextEstimate,
      contextLimit: deps.config.contextLimit,
      rounds,
      durationMs,
    };

    let resultText = '';
    if (!lastAssistant) {
      resultText = '';
    } else if (typeof lastAssistant.content === 'string') {
      resultText = lastAssistant.content;
    } else {
      resultText = lastAssistant.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n') || '';
    }

    const result: ChatResult = { text: resultText, stats };

    maybeGenerateSessionTitle(deps.store, options?.sessionId, deps.subAgent, msgs)
      .catch((err) => log(`[agent] Session title generation failed: ${err instanceof Error ? err.message : err}`));

    return result;
    } finally {
      // Shared-history calls publish the (possibly compacted/reassigned)
      // message array back to the agent; override calls leave it untouched.
      if (usesSharedHistory) {
        history = msgs;
      }
    }
  }

  function reset(): void {
    history = [];
  }

  return { chat, reset };
}
