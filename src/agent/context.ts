// pattern: Functional Core — pure functions for building agent context

import type { Message, ContentBlock, ToolUseBlock, ToolResultBlock } from '../model/types.ts';

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

      // Handle array content (e.g., image tool results with [text, image] blocks)
      if (Array.isArray(content)) {
        const hasImage = content.some(
          (b) => b.type === 'image' || b.type === 'image_url',
        );
        if (hasImage) {
          (msg.content as Array<ContentBlock>)[j] = {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: '[image tool result trimmed for context savings]',
          };
          trimmed++;
        }
        continue;
      }

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
