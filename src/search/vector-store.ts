// pattern: Functional Core (with logging exception)

export type VectorEntry = {
  id: string;
  content: string;
  embedding: Array<number>;
  metadata: Record<string, string>;
};

export type VectorStore = {
  add(entry: VectorEntry): void;
  search(queryEmbedding: ReadonlyArray<number>, limit: number): Array<{ entry: VectorEntry; score: number }>;
  remove(id: string): void;
  size(): number;
};

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

export function createVectorStore(): VectorStore {
  const entries = new Map<string, VectorEntry>();

  return {
    add(entry: VectorEntry): void {
      entries.set(entry.id, entry);
    },

    search(queryEmbedding: ReadonlyArray<number>, limit: number): Array<{ entry: VectorEntry; score: number }> {
      const results: Array<{ entry: VectorEntry; score: number }> = [];

      for (const entry of Array.from(entries.values())) {
        const score = cosineSimilarity(queryEmbedding, entry.embedding);
        results.push({ entry, score });
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },

    remove(id: string): void {
      entries.delete(id);
    },

    size(): number {
      return entries.size;
    },
  };
}
