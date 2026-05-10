// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult, BudgetTracker } from '../types.ts';
import { isImmutable } from '../state.ts';
import { findSimilarPairs, type EmbeddingPair } from '../similarity.ts';

type PruneDeps = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

type SubsetConfirmation = {
  subset: boolean;
  superset?: 'a' | 'b';
};

function cleanupOrphanedChunks(store: Store): number {
  let cleaned = 0;
  const chunkPattern = /^(knowledge:.+):chunk:\d+$/;

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      const match = chunkPattern.exec(doc.rkey);
      if (match) {
        const parentRkey = match[1]!;
        const parent = store.docGet(parentRkey);
        if (!parent) {
          store.docDelete(doc.rkey);
          cleaned++;
        }
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return cleaned;
}

export async function prune(
  deps: PruneDeps,
  _changeSet: ChangeSet,
  _mode: 'incremental' | 'full',
): Promise<StageResult> {
  const actions: Array<string> = [];

  let tokensUsed = 0;

  // ─── Redundancy Detection (optional) ────────────────────────────────────

  if (deps.embedding && deps.subAgent) {
    // Load all embeddings
    const allEmbeddings = deps.store.getAllEmbeddings();

    // Build immutable set
    const immutableRkeys = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = deps.store.docList(500, cursor);
      for (const doc of page.documents) {
        if (isImmutable(doc.rkey)) {
          immutableRkeys.add(doc.rkey);
        }
      }
      cursor = page.cursor;
    } while (cursor);

    // Convert to EmbeddingPair format
    const embeddingPairs: Array<EmbeddingPair> = allEmbeddings.map(e => ({
      rkey: e.rkey,
      embedding: e.embedding,
    }));

    // Find similar pairs, excluding immutable documents
    const similarPairs = findSimilarPairs(embeddingPairs, deps.threshold, immutableRkeys);

    // Process each similar pair
    for (const pair of similarPairs) {
      if (!deps.budget.shouldContinue()) {
        break;
      }

      const docA = deps.store.docGet(pair.a);
      const docB = deps.store.docGet(pair.b);

      if (!docA || !docB) {
        continue;
      }

      // Ask sub-agent for confirmation
      const prompt = `You are comparing two documents to detect if one is a strict information subset of the other.

Document A (${pair.a}):
${docA.content}

Document B (${pair.b}):
${docB.content}

Is document A a strict information subset of document B? That is, does B contain all the information in A (possibly with more)?
Respond with JSON: {"subset": true, "superset": "a" | "b"} or {"subset": false}`;

      let confirmation: SubsetConfirmation | null = null;
      try {
        const response = await deps.subAgent.complete(prompt, deps.systemPrompt);
        confirmation = JSON.parse(response) as SubsetConfirmation;
        tokensUsed += 100; // Estimate sub-agent tokens
      } catch (e) {
        // Failed to parse, treat as not subset
        continue;
      }

      // If not confirmed as subset or missing superset field, skip
      if (!confirmation.subset || !confirmation.superset) {
        continue;
      }

      // Determine which document is the subset
      const toDelete = confirmation.superset === 'a' ? pair.b : pair.a;

      deps.store.docDelete(toDelete);
      deps.budget.record('prune', 100);

      actions.push(
        `removed ${toDelete} as strict information subset (similarity: ${pair.similarity.toFixed(3)})`,
      );
    }
  }

  // ─── Orphaned Chunk Cleanup (always runs) ───────────────────────────────

  const orphanedCount = cleanupOrphanedChunks(deps.store);
  if (orphanedCount > 0) {
    actions.push(`cleaned up ${orphanedCount} orphaned chunk documents`);
  }

  return {
    stage: 'prune',
    tokensUsed,
    actions,
    skipped: false,
  };
}
