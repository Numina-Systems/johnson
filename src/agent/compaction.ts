// pattern: Imperative Shell — context compaction via SQLite store
//
// When conversation token count exceeds contextBudget × contextLimit:
// 1. Save full conversation to store as context:<sessionId>:<timestamp> document
// 2. Load the 2-3 most recent context documents for this session (full text)
// 3. Summarize all older context documents into one paragraph
// 4. Return rebuilt context for the agent to continue with

import type { Message } from '../model/types.ts';
import { toolResultContentToString } from '../model/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Store } from '../store/store.ts';
import { estimateTokens, estimateMessagesTokens } from './context.ts';

const CONTEXT_PREFIX = 'context:';
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
let rkeySuffix = 0;

function contextRkey(sessionId: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const suffix = String(rkeySuffix++).padStart(3, '0');
  return `${CONTEXT_PREFIX}${sessionId}:${ts}-${suffix}`;
}

/**
 * List all context documents sorted by rkey (oldest first).
 */
function listContextDocs(store: Store, sessionId: string): Array<{ rkey: string; content: string }> {
  const prefix = `${CONTEXT_PREFIX}${sessionId}:`;
  return store.docListByPrefix(prefix)
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
  const messageTokens = estimateMessagesTokens(messages);
  const totalTokens = systemTokens + messageTokens;
  const budgetThreshold = Math.floor(contextBudget * contextLimit);
  return totalTokens > budgetThreshold;
}

/**
 * Mid-loop variant of the compaction check: instead of a char-based
 * estimate, the caller passes the exact prompt size the provider
 * reported (usage.input_tokens) for the round that just completed.
 */
export function exceedsTokenBudget(
  actualInputTokens: number,
  budgetThreshold: number,
): boolean {
  return actualInputTokens > budgetThreshold;
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
 * 1. Save current conversation to store as context/<sessionId>/<timestamp> document
 * 2. Load 2-3 most recent context documents (full text)
 * 3. Summarize all older context documents
 * 4. Return messages to inject into the fresh context
 */
export async function compactContext(
  messages: ReadonlyArray<Message>,
  deps: {
    store: Store;
    subAgent: SubAgentLLM;
    sessionId?: string;
  },
): Promise<Array<Message>> {
  const sid = deps.sessionId ?? 'default';

  // 1. Save current conversation
  const rkey = contextRkey(sid);
  const conversationText = formatConversation(messages);
  deps.store.docUpsert(rkey, conversationText);

  // 2. Load all context documents (sorted oldest→newest)
  const allDocs = listContextDocs(deps.store, sid);

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
