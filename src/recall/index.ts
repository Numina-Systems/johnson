// pattern: Imperative Shell
//
// Orchestrates decomposition and retrieval into a single performRecall() entry point.
// Handles guard conditions and fallback behavior when SubAgentLLM or embeddings fail.
// No lifecycle events are emitted here (that's Phase 5).

import type { Store } from '../store/store.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import { decomposeMessage } from './decompose-message.ts';
import { fallbackDecomposition } from './decompose.ts';
import { retrieveContext, type RecallResult } from './retrieve.ts';

// ─────────────────────────────────────────────────────────────────────────
// Re-exports for public API
// ─────────────────────────────────────────────────────────────────────────

export type { DecompositionResult } from './decompose.ts';
export type { RecallFragment, RecallResult } from './retrieve.ts';

// ─────────────────────────────────────────────────────────────────────────
// RecallDeps type
// ─────────────────────────────────────────────────────────────────────────

export type RecallDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider | undefined;
  readonly subAgent: SubAgentLLM | undefined;
  readonly tokenBudget: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Performs semantic recall by decomposing a message and retrieving relevant context.
 *
 * Guard conditions (return null early):
 * 1. Message < 10 chars (AC6.2)
 * 2. No embedding provider available (AC6.4)
 * 3. Store has no documents (AC6.3)
 *
 * Fallback cascade:
 * - SubAgentLLM undefined → uses fallbackDecomposition (raw message as query) (AC5.1)
 * - SubAgentLLM failure → caught in decomposeMessage, falls back to raw message (AC5.2)
 * - Embedding failure → caught in hybridSearch, falls back to FTS-only (AC5.3)
 * - Both failures → raw message + FTS results (AC5.4)
 *
 * Returns RecallResult with fragments, totalTokens, queryCount, and elapsed time.
 * Returns null if guards fail.
 */
export async function performRecall(message: string, deps: RecallDeps): Promise<RecallResult | null> {
  // Guard condition 1: Skip if message too short (AC6.2)
  if (message.trim().length < 10) {
    return null;
  }

  // Guard condition 2: Skip if no embedding provider (AC6.4)
  if (!deps.embedding) {
    return null;
  }

  // Guard condition 3: Skip if store has no documents (AC6.3)
  const docListResult = deps.store.docList(1);
  if (docListResult.documents.length === 0) {
    return null;
  }

  // Record start time for elapsed measurement
  const startTime = Date.now();

  // Decomposition step: either use subAgent or fallback
  const decomposition = deps.subAgent
    ? await decomposeMessage(message, deps.subAgent)
    : fallbackDecomposition(message);

  // Retrieval step: search for relevant context
  // The embedding non-null assertion is safe because guard condition 2 checked it
  const result = await retrieveContext(
    decomposition,
    { store: deps.store, embedding: deps.embedding },
    deps.tokenBudget,
  );

  // Set elapsed time
  result.elapsed = Date.now() - startTime;

  return result;
}
