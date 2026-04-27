// pattern: Imperative Shell — async coordination with sub-agent and store

import type { Store } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Message } from '../model/types.ts';

const MAX_MESSAGES = 10;
const MAX_CONTENT_LENGTH = 200;
const MAX_TITLE_LENGTH = 80;

const TITLE_SYSTEM_PROMPT =
  'Summarize the topic of this short conversation as a concise title ' +
  '(5-8 words, no quotes, no trailing punctuation, plain text only). ' +
  'Respond with only the title.';

function formatMessagesForTitle(messages: ReadonlyArray<Message>): string {
  return messages.slice(0, MAX_MESSAGES).map((msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join(' ');
    const truncated = content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '...'
      : content;
    return `${msg.role}: ${truncated}`;
  }).join('\n');
}

export function postProcessTitle(raw: string): string {
  let title = raw.trim();

  const newlineIdx = title.indexOf('\n');
  if (newlineIdx >= 0) {
    title = title.slice(0, newlineIdx).trim();
  }

  title = title.replace(/^["']+|["']+$/g, '');
  title = title.replace(/[.!?]+$/, '');

  title = title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }

  return title;
}

export async function maybeGenerateSessionTitle(
  store: Store,
  sessionId: string | undefined,
  subAgent: SubAgentLLM | undefined,
  messages: ReadonlyArray<Message>,
): Promise<void> {
  if (!subAgent) return;
  if (!sessionId) return;

  const session = store.getSession(sessionId);
  if (session?.title) return;

  const userMessageCount = messages.filter((m) => m.role === 'user').length;
  if (userMessageCount < 2) return;

  const formatted = formatMessagesForTitle(messages);
  const raw = await subAgent.complete(formatted, TITLE_SYSTEM_PROMPT);
  const title = postProcessTitle(raw);

  if (title.length === 0) return;

  store.updateSessionTitle(sessionId, title);
}
