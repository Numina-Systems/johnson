// pattern: Functional Core

export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
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

export type EmbeddingPair = {
  readonly rkey: string;
  readonly embedding: ReadonlyArray<number>;
};

export function findSimilarPairs(
  embeddings: ReadonlyArray<EmbeddingPair>,
  threshold: number,
  excludeRkeys: ReadonlySet<string>,
): ReadonlyArray<{ a: string; b: string; similarity: number }> {
  const results: Array<{ a: string; b: string; similarity: number }> = [];

  for (let i = 0; i < embeddings.length; i++) {
    const ea = embeddings[i]!;
    if (excludeRkeys.has(ea.rkey)) continue;

    for (let j = i + 1; j < embeddings.length; j++) {
      const eb = embeddings[j]!;
      if (excludeRkeys.has(eb.rkey)) continue;

      const sim = cosineSimilarity(ea.embedding, eb.embedding);
      if (sim >= threshold) {
        results.push({ a: ea.rkey, b: eb.rkey, similarity: sim });
      }
    }
  }

  return results.sort((x, y) => y.similarity - x.similarity);
}
