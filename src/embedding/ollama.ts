// pattern: Imperative Shell

import type { EmbeddingConfig } from '../config/types.ts';
import type { EmbeddingProvider } from './types.ts';

const DEFAULT_ENDPOINT = 'http://localhost:11434';

export function createOllamaEmbedding(config: Readonly<EmbeddingConfig>): EmbeddingProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const url = `${endpoint}/api/embed`;

  async function requestEmbeddings(input: string | ReadonlyArray<string>): Promise<Array<Array<number>>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embed failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { embeddings: Array<Array<number>> };
    return data.embeddings;
  }

  return {
    dimensions: config.dimensions,

    async embed(text: string): Promise<Array<number>> {
      const embeddings = await requestEmbeddings(text);
      const first = embeddings[0];
      if (!first) throw new Error('no embedding returned from Ollama');
      return first;
    },

    async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
      return requestEmbeddings(texts);
    },
  };
}
