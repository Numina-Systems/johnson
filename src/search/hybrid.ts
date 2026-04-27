// pattern: Functional Core
//
// Hybrid search combining FTS5 keyword search + vector cosine similarity,
// merged via Reciprocal Rank Fusion (RRF).

import type { EmbeddingProvider } from '../embedding/types.ts';

// ---------------------------------------------------------------------------
// Store interface — matches the contract from ../store/store.ts
// ---------------------------------------------------------------------------

export type Store = {
  docSearch(query: string, limit: number): Array<{ rkey: string; content: string; rank: number }>;
  getAllEmbeddings(): Array<{ rkey: string; embedding: Array<number>; model: string }>;
  getStaleEmbeddings(model: string): Array<{ rkey: string; content: string }>;
  saveEmbedding(rkey: string, embedding: Array<number>, model: string): void;
  docGet(rkey: string): { content: string } | null;
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HybridSearchResult = {
  rkey: string;
  content: string;
  score: number;         // RRF combined score
  ftsRank?: number;      // BM25 rank position (1-based)
  vectorRank?: number;   // cosine similarity rank position (1-based)
};

export type HybridSearchDeps = {
  store: Store;
  embedding: EmbeddingProvider;
};

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// RRF constant
// ---------------------------------------------------------------------------

const RRF_K = 60;

// ---------------------------------------------------------------------------
// hybridSearch
// ---------------------------------------------------------------------------

export async function hybridSearch(
  deps: HybridSearchDeps,
  query: string,
  limit: number = 10,
): Promise<Array<HybridSearchResult>> {
  const expandedLimit = limit * 2;

  // 1. FTS5 keyword search
  const ftsResults = deps.store.docSearch(query, expandedLimit);

  // Build FTS rank map (1-based)
  const ftsRankMap = new Map<string, number>();
  for (let i = 0; i < ftsResults.length; i++) {
    ftsRankMap.set(ftsResults[i]!.rkey, i + 1);
  }

  // 2–5. Vector similarity search (with graceful degradation)
  const vectorRankMap = new Map<string, number>();

  try {
    const allEmbeddings = deps.store.getAllEmbeddings();

    if (allEmbeddings.length > 0) {
      const queryEmbedding = await deps.embedding.embed(query);

      // Compute cosine similarity for every stored embedding
      const scored = allEmbeddings.map((entry) => ({
        rkey: entry.rkey,
        similarity: cosineSimilarity(queryEmbedding, entry.embedding),
      }));

      // Sort descending by similarity, take top expandedLimit
      scored.sort((a, b) => b.similarity - a.similarity);
      const topVector = scored.slice(0, expandedLimit);

      for (let i = 0; i < topVector.length; i++) {
        vectorRankMap.set(topVector[i]!.rkey, i + 1);
      }
    }
  } catch {
    // Embedding provider threw — fall back to FTS only
  }

  // 6. Reciprocal Rank Fusion
  const allRkeys = new Set<string>([...Array.from(ftsRankMap.keys()), ...Array.from(vectorRankMap.keys())]);

  const fusedResults: Array<{ rkey: string; score: number; ftsRank?: number; vectorRank?: number }> = [];

  for (const rkey of Array.from(allRkeys)) {
    let score = 0;
    const ftsRank = ftsRankMap.get(rkey);
    const vectorRank = vectorRankMap.get(rkey);

    if (ftsRank !== undefined) {
      score += 1 / (RRF_K + ftsRank);
    }
    if (vectorRank !== undefined) {
      score += 1 / (RRF_K + vectorRank);
    }

    fusedResults.push({ rkey, score, ftsRank, vectorRank });
  }

  // 7. Sort by RRF score descending, take top limit
  fusedResults.sort((a, b) => b.score - a.score);
  const topResults = fusedResults.slice(0, limit);

  // 8. Load full content for each result
  const results: Array<HybridSearchResult> = [];

  for (const item of topResults) {
    const doc = deps.store.docGet(item.rkey);
    if (!doc) continue;

    results.push({
      rkey: item.rkey,
      content: doc.content,
      score: item.score,
      ftsRank: item.ftsRank,
      vectorRank: item.vectorRank,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// reindexEmbeddings — find stale/missing embeddings and re-embed in batches
// ---------------------------------------------------------------------------

const BATCH_SIZE = 10;

export async function reindexEmbeddings(deps: HybridSearchDeps, model: string): Promise<number> {
  const stale = deps.store.getStaleEmbeddings(model);
  if (stale.length === 0) return 0;

  let count = 0;

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = stale.slice(i, i + BATCH_SIZE);
    const texts = batch.map((entry) => entry.content);

    try {
      const embeddings = await deps.embedding.embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        deps.store.saveEmbedding(batch[j]!.rkey, embeddings[j]!, model);
        count++;
      }
    } catch {
      // Batch failed (likely context length) — fall back to one-by-one
      for (const entry of batch) {
        try {
          const [embedding] = await deps.embedding.embedBatch([entry.content]);
          if (embedding) {
            deps.store.saveEmbedding(entry.rkey, embedding, model);
            count++;
          }
        } catch {
          // Skip this document — too large even individually
        }
      }
    }
  }

  return count;
}
