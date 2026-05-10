// pattern: Imperative Shell

import type { Store } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { ArchiveResult, PruneResult, SessionWithCounts } from './types.ts';
import { loadConversation } from '../agent/messages.ts';
import { buildArchiveRkey, classifySession, formatArchiveDocument } from './archive.ts';
import { formatConversation } from '../agent/compaction.ts';

const SUMMARIZATION_SYSTEM_PROMPT = 'You are a conversation summarizer. Given a conversation transcript, produce a concise 2-4 sentence summary of the key topics discussed and any outcomes or decisions.';

export async function archiveSession(
  sessionId: string,
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
  embeddingModel?: string,
): Promise<ArchiveResult> {
  // 1. Load session and raw message rows
  const session = store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const messageRows = store.getMessages(sessionId);
  const messages = loadConversation(store, sessionId);

  // 4. Build SessionWithCounts
  const lastMessage = messageRows.length > 0 ? messageRows[messageRows.length - 1] : null;
  const meta: SessionWithCounts = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    lastMessageAt: lastMessage?.createdAt ?? null,
  };

  let summary: string | undefined;

  // 5. Generate summary for sessions with > 5 messages
  if (messages.length > 5 && subAgent) {
    try {
      const transcript = formatConversation(messages);
      summary = await subAgent.complete(transcript, SUMMARIZATION_SYSTEM_PROMPT);
    } catch {
      // Continue without summary if LLM fails (AC3.4)
    }
  }

  // 6. Format archive document
  const document = formatArchiveDocument(meta, messages, new Date().toISOString(), summary);

  // 7. Build rkey and upsert
  const rkey = buildArchiveRkey(session.title, session.updatedAt);
  store.docUpsert(rkey, document);

  // 9. Generate embeddings if provider available
  if (embedding) {
    try {
      const textToEmbed = messages.length > 5 && summary ? summary : document;
      const vector = await embedding.embed(textToEmbed);
      store.saveEmbedding(rkey, vector, embeddingModel ?? 'nomic-embed-text');
    } catch {
      // Continue without embedding if provider fails (AC3.7)
    }
  }

  // 10. Delete original session
  store.deleteSession(sessionId);

  return {
    rkey,
    title: session.title,
    messageCount: messages.length,
  };
}

export async function pruneSessions(
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
  embeddingModel?: string,
  now?: Date,
): Promise<PruneResult> {
  const sessions = store.listSessionsWithCounts();
  const now_ = now ?? new Date();

  const details: Array<{
    readonly id: string;
    readonly title: string | null;
    readonly action: 'deleted' | 'archived';
    readonly rkey?: string;
  }> = [];

  let deletedCount = 0;
  let archivedCount = 0;

  for (const session of sessions) {
    const classification = classifySession(session.messageCount, session.updatedAt, now_);

    if (classification === 'delete') {
      store.deleteSession(session.id);
      deletedCount++;
      details.push({
        id: session.id,
        title: session.title,
        action: 'deleted',
      });
    } else if (classification === 'archive') {
      const result = await archiveSession(session.id, store, subAgent, embedding, embeddingModel);
      archivedCount++;
      details.push({
        id: session.id,
        title: session.title,
        action: 'archived',
        rkey: result.rkey,
      });
    }
    // Skip 'active' sessions
  }

  return {
    deleted: deletedCount,
    archived: archivedCount,
    details,
  };
}
