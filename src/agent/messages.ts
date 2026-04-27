// pattern: Functional Core — message serialization for persistent sessions

import type { Message, ContentBlock } from '../model/types.ts';
import type { Store } from '../store/store.ts';

/**
 * Deserialize a stored message back into the agent's Message type.
 * Attempts JSON parse for structured content; falls back to plain string.
 */
export function deserializeMessage(role: string, content: string): Message {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { role: role as 'user' | 'assistant', content: parsed as ContentBlock[] };
    }
  } catch { /* plain string */ }
  return { role: role as 'user' | 'assistant', content };
}

/**
 * Load a full conversation from the store for a given session ID.
 * Returns Message[] suitable for passing as conversationOverride.
 */
export function loadConversation(store: Store, sessionId: string, limit: number = 500): Message[] {
  const rows = store.getMessages(sessionId, limit);
  return rows.map(r => deserializeMessage(r.role, r.content));
}
