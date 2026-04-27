// pattern: Imperative Shell — agent loop with execute_code dispatch

import { join } from 'node:path';
import type {
  Message,
  ToolUseBlock,
  ToolResultBlock,
  ToolDefinition,
  ContentBlock,
} from '../model/types.ts';
import type { Agent, AgentDependencies, ChatContext, ChatImage, ChatResult, ChatStats, ChatOptions } from './types.ts';
import { buildSystemPrompt, estimateTokens, loadCoreMemoryFromStore, repairConversation, trimOldToolResults } from './context.ts';
import { needsCompaction, compactContext } from './compaction.ts';
import { createAgentTools } from './tools.ts';

const DENO_DIR = join(import.meta.dir, '..', 'runtime', 'deno');

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

export function createAgent(deps: Readonly<AgentDependencies>): Agent {
  let history: Array<Message> = [];
  let currentContext: ChatContext = {};

  // Serialize all chat() calls — history is shared mutable state.
  // Without this lock, a Discord message arriving during a TUI chat's
  // LLM await could corrupt the conversation.
  let chatLock: Promise<void> = Promise.resolve();

  async function chat(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    let releaseLock: () => void;
    const prevLock = chatLock;
    chatLock = new Promise<void>((r) => { releaseLock = r; });

    await prevLock;
    try {
      return await _chatImpl(userMessage, options);
    } finally {
      releaseLock!();
    }
  }

  async function _chatImpl(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    const chatStart = performance.now();
    currentContext = options?.context ?? {};
    const images = options?.images;

    // Swap history if conversationOverride provided
    const savedHistory = options?.conversationOverride !== undefined ? history : null;
    if (options?.conversationOverride !== undefined) {
      history = [...options.conversationOverride];
    }

    try {

    // Create tool registry (fresh each call — context may change)
    const registry = createAgentTools(deps, currentContext);

    // Generate TypeScript stubs for the Deno sandbox
    const stubsCode = registry.generateTypeScriptStubs();
    await Bun.write(join(DENO_DIR, 'tools.ts'), stubsCode);

    // Generate tool docs for system prompt
    const toolDocs = registry.generateToolDocumentation();

    // a. Read persona
    const persona = await Bun.file(deps.personaPath).text();

    // b. Load core memory (self document) and list skill names
    const coreMemory = loadCoreMemoryFromStore(deps.store);
    const allDocs = deps.store.docList(500);
    const skillNames = allDocs.documents
      .filter(d => d.rkey.startsWith('skill:'))
      .map(d => d.rkey);

    // c. Build system prompt (now includes tool docs)
    const systemPrompt = buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, deps.config.timezone);

    // Track cumulative stats across rounds
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let rounds = 0;

    // d. Append user message
    if (images && images.length > 0) {
      const blocks: ContentBlock[] = [
        { type: 'text', text: userMessage },
        ...images.map(img => ({ type: 'image_url' as const, image_url: { url: img.url } })),
      ];
      history.push({ role: 'user', content: blocks });
    } else {
      history.push({ role: 'user', content: userMessage });
    }

    // d.1 Repair any orphaned tool_use blocks from previous crashes
    const repairedCount = repairConversation(history);
    if (repairedCount > 0) {
      process.stderr.write(`[agent] Repaired ${repairedCount} orphaned tool_use block(s)\n`);
    }

    // d.2 Trim verbose tool results in older messages
    trimOldToolResults(history);

    // Handle context overflow via compaction
    if (needsCompaction(history, systemPrompt, deps.config.contextLimit, deps.config.contextBudget)) {
      const compacted = await compactContext(history, {
        store: deps.store,
        subAgent: deps.subAgent!,
      });
      // Replace history with compacted context + current user message
      const currentMessage = history[history.length - 1];
      history = [...compacted, ...(currentMessage ? [currentMessage] : [])];

    }

    // e. Tool loop
    let exitedNormally = false;
    for (let round = 0; round < deps.config.maxToolRounds; round++) {
      let response;
      try {
        response = await deps.model.complete({
          system: systemPrompt,
          messages: history,
          tools: [EXECUTE_CODE_TOOL],
          model: deps.config.model,
          max_tokens: deps.config.maxTokens,
          temperature: deps.config.temperature,
          timeout: deps.config.modelTimeout,
        });
      } catch (err) {
        // Model call failed (socket drop, timeout, etc.)
        // History is safe — no assistant message was added yet.
        // Re-throw so the caller can handle it (e.g. show error to user).
        throw new Error(`Model call failed: ${err instanceof Error ? err.message : err}`);
      }

      // Accumulate usage stats
      rounds++;
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const toolBlocks = response.content.filter(b => b.type === 'tool_use').length;
      const textBlocks = response.content.filter(b => b.type === 'text').length;
      process.stderr.write(`[agent] round=${round} stop_reason=${response.stop_reason} content_blocks=${response.content.length} tool_use=${toolBlocks} text=${textBlocks}\n`);

      // Append assistant response
      const assistantMessage: Message = { role: 'assistant', content: response.content };
      if (response.reasoning_content) {
        assistantMessage.reasoning_content = response.reasoning_content;
      }
      history.push(assistantMessage);

      // Check stop reason
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        process.stderr.write(`[agent] loop exiting: ${response.stop_reason}\n`);
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
                const code = (block.input as Record<string, unknown>)['code'];
                if (typeof code !== 'string') {
                  return { type: 'tool_result', tool_use_id: block.id, content: 'Error: missing code parameter', is_error: true };
                }

                // IPC callback: dispatch tool calls from the sandbox through the registry
                const onToolCall = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
                  return registry.execute(name, params);
                };

                const result = await deps.runtime.execute(code, undefined, onToolCall);
                const output = result.success
                  ? result.output || '(no output)'
                  : `Error: ${result.error ?? 'unknown error'}\n${result.output}`;
                return { type: 'tool_result', tool_use_id: block.id, content: output, is_error: !result.success };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { type: 'tool_result', tool_use_id: block.id, content: `Tool error: ${message}`, is_error: true };
              }
            }),
          );

          // Append tool results as user message
          history.push({ role: 'user', content: toolResults });
        } catch (err) {
          // Tool dispatch crashed — assistant message with tool_use is in history
          // but no tool_result. repairConversation will fix this next call.
          throw new Error(`Tool dispatch failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // g. Handle max-iteration exhaustion — force a text-only wrap-up
    if (!exitedNormally) {
      process.stderr.write(`[agent] max tool rounds (${deps.config.maxToolRounds}) exhausted, forcing final response\n`);

      history.push({
        role: 'user',
        content: '[System: Max tool calls reached. Provide final response now.]',
      });

      const finalResponse = await deps.model.complete({
        system: systemPrompt,
        messages: history,
        tools: [],
        model: deps.config.model,
        max_tokens: deps.config.maxTokens,
        temperature: deps.config.temperature,
        timeout: deps.config.modelTimeout,
      });

      rounds++;
      totalInputTokens += finalResponse.usage.input_tokens;
      totalOutputTokens += finalResponse.usage.output_tokens;

      history.push({ role: 'assistant', content: finalResponse.content });
    }

    // f. Extract final text from last assistant message
    const lastAssistant = history.findLast((msg) => msg.role === 'assistant');
    const durationMs = Math.round(performance.now() - chatStart);

    // Estimate current context size
    const contextEstimate = estimateTokens(systemPrompt) +
      history.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return sum + estimateTokens(content);
      }, 0);

    const stats: ChatStats = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      contextEstimate,
      contextLimit: deps.config.contextLimit,
      rounds,
      durationMs,
    };

    if (!lastAssistant) return { text: '', stats };

    if (typeof lastAssistant.content === 'string') return { text: lastAssistant.content, stats };

    const textBlocks = lastAssistant.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text);

    return { text: textBlocks.join('\n') || '', stats };
    } finally {
      // Restore original history if we swapped
      if (savedHistory !== null) {
        history = savedHistory;
      }
    }
  }

  function reset(): void {
    history = [];
  }

  return { chat, reset };
}
