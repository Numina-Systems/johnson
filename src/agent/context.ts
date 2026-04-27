// pattern: Functional Core — pure functions for building agent context

import type { Message, ContentBlock, ToolUseBlock, ToolResultBlock } from '../model/types.ts';
import type { Store } from '../store/store.ts';

/**
 * Load the agent's core identity from the `self` document.
 * Returns the document content, or empty string if not set.
 */
export function loadCoreMemoryFromStore(store: Store): string {
  const doc = store.docGet('self');
  if (!doc || !doc.content.trim()) return '';
  return `\n\n## Your Memory (auto-loaded)\nThis is your saved identity and memory:\n\n${doc.content.trim()}`;
}

export function buildSystemPrompt(
  persona: string,
  selfDoc: string,
  skillNames: ReadonlyArray<string>,
  toolDocs: string = '',
  timezone: string = 'UTC',
): string {
  const sections: Array<string> = [persona.trim()];

  // Inject current local time so the model always knows the date/time/timezone
  const now = new Date();
  const formatted = now.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  sections.push(`\n## Current Time\n${formatted} (${timezone})\n\nAll times you present to the user MUST be in ${timezone}. Never use UTC unless explicitly asked.`);

  // Core memory (self document)
  if (selfDoc) {
    sections.push(selfDoc);
  }

  sections.push('\n\n## Available Skills');
  if (skillNames.length === 0) {
    sections.push('No skills saved yet. You can save working code as reusable skills with doc_upsert using a `skill:<name>` rkey.');
  } else {
    sections.push(
      'You can run these saved skills. Use doc_get to load skill content before running:\n' +
        skillNames.map((s) => `- ${s}`).join('\n'),
    );
  }

  if (toolDocs) {
    sections.push('\n\n## Tool Reference\n\nTools marked with `tools.<name>` are available **only inside TypeScript code you run via `execute_code`.** Call them as `await tools.<method>({...})`. Tools marked *(direct tool call)* are called directly — do NOT use execute_code for those.\n');
    sections.push(toolDocs);
  }

  return sections.join('\n');
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Number of recent messages whose tool results are kept intact.
 * Older tool results are replaced with a byte-count placeholder.
 */
const TOOL_RESULT_PRESERVE_COUNT = 8;

/**
 * Repair orphaned tool_use blocks in conversation history.
 *
 * If a previous chat() call crashed mid-tool-execution (socket drop, timeout),
 * the history may contain assistant messages with tool_use blocks that lack
 * matching tool_result responses. The API rejects these. This patches them up.
 *
 * Mutates the array in place.
 */
export function repairConversation(messages: Array<Message>): number {
  let repaired = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;
    if (typeof msg.content === 'string') continue;

    // Find all tool_use IDs in this assistant message
    const toolUseIds = msg.content
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map((b) => b.id);

    if (toolUseIds.length === 0) continue;

    // Check the next message for matching tool_results
    const nextMsg = messages[i + 1];
    const existingResultIds = new Set<string>();

    if (nextMsg && nextMsg.role === 'user' && Array.isArray(nextMsg.content)) {
      for (const block of nextMsg.content) {
        if (block.type === 'tool_result') {
          existingResultIds.add(block.tool_use_id);
        }
      }
    }

    const missing = toolUseIds.filter((id) => !existingResultIds.has(id));
    if (missing.length === 0) continue;

    repaired += missing.length;

    const patch: Array<ToolResultBlock> = missing.map((id) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: '[result unavailable — previous execution was interrupted]',
    }));

    if (existingResultIds.size > 0 && nextMsg && nextMsg.role === 'user' && Array.isArray(nextMsg.content)) {
      // Append missing results to existing tool_result message
      (nextMsg.content as Array<ContentBlock>).push(...patch);
    } else {
      // Insert a new tool_result message after the assistant message
      messages.splice(i + 1, 0, { role: 'user', content: patch });
    }
  }

  return repaired;
}

/**
 * Replace verbose tool_result content in older messages with a short placeholder.
 *
 * Keeps the last TOOL_RESULT_PRESERVE_COUNT messages' tool results intact
 * so the LLM has recent context, but shrinks older ones to save tokens.
 *
 * Mutates the array in place.
 */
export function trimOldToolResults(messages: Array<Message>): number {
  let trimmed = 0;
  const cutoff = messages.length - TOOL_RESULT_PRESERVE_COUNT;

  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'user') continue;
    if (!Array.isArray(msg.content)) continue;

    for (let j = 0; j < msg.content.length; j++) {
      const block = msg.content[j]!;

      // Strip image blocks from older messages to save context
      if (block.type === 'image_url') {
        (msg.content as Array<ContentBlock>)[j] = {
          type: 'text',
          text: '[image removed for context savings]',
        };
        trimmed++;
        continue;
      }

      if (block.type !== 'tool_result') continue;

      const content = block.content;
      if (typeof content !== 'string') continue;

      // Skip if already trimmed or small
      if (content.startsWith('[tool result:') || content.length < 200) continue;

      const kb = (new TextEncoder().encode(content).byteLength / 1024).toFixed(1);
      (msg.content as Array<ContentBlock>)[j] = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: `[tool result: ${kb}KB — trimmed for context savings]`,
      };
      trimmed++;
    }
  }

  return trimmed;
}

export function shouldTruncate(
  messages: ReadonlyArray<Message>,
  systemPrompt: string,
  budget: number,
  maxTokens: number,
): boolean {
  const systemTokens = estimateTokens(systemPrompt);
  const messageTokens = messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    return sum + estimateTokens(content);
  }, 0);
  return systemTokens + messageTokens + maxTokens > budget;
}
