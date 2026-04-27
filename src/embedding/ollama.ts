// pattern: Imperative Shell

import type { EmbeddingConfig } from '../config/types.ts';
import type { EmbeddingProvider } from './types.ts';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const CHARS_PER_TOKEN = 3.5;

function truncateToContext(text: string, contextLength: number): string {
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function createOllamaEmbedding(config: Readonly<EmbeddingConfig>): EmbeddingProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const url = `${endpoint}/api/embed`;
  const contextLength = config.contextLength;

  async function requestEmbeddings(input: string | ReadonlyArray<string>): Promise<Array<Array<number>>> {
    const truncated = typeof input === 'string'
      ? truncateToContext(input, contextLength)
      : input.map((t) => truncateToContext(t, contextLength));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input: truncated }),
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
