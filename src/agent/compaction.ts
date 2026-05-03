// pattern: Imperative Shell — context compaction via SQLite store
//
// When conversation token count exceeds contextBudget × contextLimit:
// 1. Save full conversation to store as archive:<timestamp> document
// 2. Load the 2-3 most recent context documents (full text)
// 3. Summarize all older context documents into one paragraph
// 4. Return rebuilt context for the agent to continue with

import type { Message } from '../model/types.ts';
import { toolResultContentToString } from '../model/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Store } from '../store/store.ts';
import { estimateTokens } from './context.ts';

const CONTEXT_PREFIX = 'archive:';
const RECENT_NOTES_COUNT = 3;

/**
 * Format a conversation history as readable markdown.
 */
export function formatConversation(messages: ReadonlyArray<Message>): string {
  return messages
    .map((msg) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((block) => {
                if (block.type === 'text') return block.text;
                if (block.type === 'image_url') return '[image]';
                if (block.type === 'tool_use') return `[tool_use: ${block.name}]`;
                if (block.type === 'tool_result') return `[tool_result: ${toolResultContentToString(block.content).slice(0, 200)}]`;
                return '';
              })
              .filter(Boolean)
              .join('\n');

      const sections: string[] = [];
      if (msg.reasoning_content) {
        sections.push(`### ${msg.role} (reasoning)\n${msg.reasoning_content}`);
      }
      sections.push(`### ${msg.role}\n${content}`);
      return sections.join('\n\n');
    })
    .join('\n\n');
}

/**
 * Generate a timestamp-based rkey for context documents.
 */
function contextRkey(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${CONTEXT_PREFIX}${ts}`;
}

/**
 * List all context documents sorted by rkey (oldest first).
 */
function listContextDocs(store: Store): Array<{ rkey: string; content: string }> {
  const result = store.docList(500);
  return result.documents
    .filter((d) => d.rkey.startsWith(CONTEXT_PREFIX))
    .sort((a, b) => a.rkey.localeCompare(b.rkey))
    .map((d) => ({ rkey: d.rkey, content: d.content }));
}

/**
 * Check if compaction is needed based on current token usage.
 *
 * Two thresholds (belt and suspenders):
 *   - contextBudget × contextLimit: the "soft" trigger (e.g. 0.8 × 160000 = 128000)
 *   - contextLimit: the absolute hard cap
 * Compaction fires when EITHER threshold is exceeded.
 * With contextBudget < 1.0 the soft trigger always fires first,
 * giving the compaction pass headroom before hitting the wall.
 */
export function needsCompaction(
  messages: ReadonlyArray<Message>,
  systemPrompt: string,
  contextLimit: number,
  contextBudget: number = 1.0,
): boolean {
  const systemTokens = estimateTokens(systemPrompt);
  const messageTokens = messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + estimateTokens(content);
  }, 0);
  const totalTokens = systemTokens + messageTokens;
  const budgetThreshold = Math.floor(contextBudget * contextLimit);
  return totalTokens > budgetThreshold;
}

/**
 * Summarize a batch of context notes into a single paragraph.
 * Uses a dedicated LLM call (option A — mechanical, out of the agent's way).
 */
async function summarizeOlderContext(
  subAgent: SubAgentLLM,
  notes: ReadonlyArray<string>,
): Promise<string> {
  if (notes.length === 0) return '';

  const combined = notes
    .map((text, i) => `--- Context ${i + 1} ---\n${text.slice(0, 3000)}`)
    .join('\n\n');

  const system =
    'You are a context summarizer. Given conversation logs, produce a concise 2-4 sentence summary capturing the key topics discussed, decisions made, and any important facts or preferences revealed. Focus on what would be useful for continuing the conversation. Do not use markdown headers or bullet points — write flowing prose.';

  const text = await subAgent.complete(combined, system);
  return text || '(summary unavailable)';
}

/**
 * Perform context compaction:
 * 1. Save current conversation to store as context/<timestamp> document
 * 2. Load 2-3 most recent context documents (full text)
 * 3. Summarize all older context documents
 * 4. Return messages to inject into the fresh context
 */
export async function compactContext(
  messages: ReadonlyArray<Message>,
  deps: {
    store: Store;
    subAgent: SubAgentLLM;
  },
): Promise<Array<Message>> {
  // 1. Save current conversation
  const rkey = contextRkey();
  const conversationText = formatConversation(messages);
  deps.store.docUpsert(rkey, conversationText);

  // 2. Load all context documents (sorted oldest→newest)
  const allDocs = listContextDocs(deps.store);

  // 3. Split into recent (full text) and older (to summarize)
  const recentDocs = allDocs.slice(-RECENT_NOTES_COUNT);
  const olderDocs = allDocs.slice(0, -RECENT_NOTES_COUNT);

  // 4. Read recent docs in full
  const recentTexts = recentDocs.map(
    (d) => `## Recent context: ${d.rkey}\n${d.content}`,
  );

  // 5. Summarize older docs (dedicated LLM call)
  let olderSummary = '';
  if (olderDocs.length > 0) {
    olderSummary = await summarizeOlderContext(
      deps.subAgent,
      olderDocs.map((d) => d.content),
    );
  }

  // 6. Build the compaction message
  const sections: Array<string> = [];

  sections.push('[Context was compacted. Recent memory and a summary of earlier context have been restored. Use doc_search if you need deeper recall.]');

  if (olderSummary) {
    sections.push(`## Earlier context summary\n${olderSummary}`);
  }

  // Recent context docs in full
  sections.push(...recentTexts);

  const compactionMessage: Message = {
    role: 'user',
    content: sections.join('\n\n'),
  };

  return [compactionMessage];
}
