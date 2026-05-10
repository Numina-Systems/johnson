// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult, BudgetTracker } from '../types.ts';
import { isImmutable } from '../state.ts';
import { findSimilarPairs, type EmbeddingPair } from '../similarity.ts';

type DedupDeps = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

function deleteDocAndChunks(store: Store, rkey: string): number {
  let deleted = 0;
  store.docDelete(rkey);
  deleted++;

  let i = 0;
  while (store.docGet(`${rkey}:chunk:${i}`)) {
    store.docDelete(`${rkey}:chunk:${i}`);
    deleted++;
    i++;
  }

  return deleted;
}

type DedupConfirmation = {
  duplicate: boolean;
  keep?: 'a' | 'b';
};

export async function dedup(
  deps: DedupDeps,
  changeSet: ChangeSet,
  _mode: 'incremental' | 'full',
): Promise<StageResult> {
  const actions: Array<string> = [];

  // Guard: require both embedding provider and sub-agent
  if (!deps.embedding || !deps.subAgent) {
    return {
      stage: 'dedup',
      tokensUsed: 0,
      actions,
      skipped: true,
    };
  }

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

  // If no similar pairs found, return early
  if (similarPairs.length === 0) {
    return {
      stage: 'dedup',
      tokensUsed: 0,
      actions,
      skipped: false,
    };
  }

  let tokensUsed = 0;

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
    const prompt = `You are comparing two documents for duplication.

Document A (${pair.a}):
${docA.content}

Document B (${pair.b}):
${docB.content}

Are these two documents semantically equivalent? If yes, which should be kept (the more complete one)?
Respond with JSON: {"duplicate": true, "keep": "a" | "b"} or {"duplicate": false}`;

    let confirmation: DedupConfirmation | null = null;
    try {
      const response = await deps.subAgent.complete(prompt, deps.systemPrompt);
      confirmation = JSON.parse(response) as DedupConfirmation;
      tokensUsed += 100; // Estimate sub-agent tokens
    } catch (e) {
      // Failed to parse, treat as not duplicate
      continue;
    }

    // If not confirmed as duplicate or missing keep field, skip
    if (!confirmation.duplicate || !confirmation.keep) {
      continue;
    }

    // Determine winner and loser
    const [winner, loser, keepKey] = confirmation.keep === 'a'
      ? [docA, docB, pair.a]
      : [docB, docA, pair.b];
    const loserKey = confirmation.keep === 'a' ? pair.b : pair.a;

    // Merge: append marker to winner
    const timestamp = new Date().toISOString();
    const mergedContent = `${winner.content}\n<!-- merged-from: ${loserKey}, ${timestamp} -->`;

    deps.store.docUpsert(keepKey, mergedContent);

    // Delete loser and its chunks
    const deletedCount = deleteDocAndChunks(deps.store, loserKey);

    deps.budget.record('dedup', 100);
    actions.push(
      `merged ${loserKey} into ${keepKey} (similarity: ${pair.similarity.toFixed(3)}), deleted ${deletedCount} documents`,
    );
  }

  return {
    stage: 'dedup',
    tokensUsed,
    actions,
    skipped: false,
  };
}
