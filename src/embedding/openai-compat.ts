// pattern: Imperative Shell

import type { EmbeddingConfig } from '../config/types.ts';
import type { EmbeddingProvider } from './types.ts';

const CHARS_PER_TOKEN = 2.5;

function truncateToContext(text: string, contextLength: number): string {
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: Array<number> }>;
};

export function createOpenAICompatEmbedding(config: Readonly<EmbeddingConfig>): EmbeddingProvider {
  if (!config.endpoint) {
    throw new Error(`Embedding provider "${config.provider}" requires endpoint (e.g. "http://localhost:13305/v1")`);
  }
  const url = `${config.endpoint.replace(/\/+$/, '')}/embeddings`;
  const contextLength = config.contextLength;
  const apiKey = config.apiKey;

  async function requestEmbeddings(input: string | ReadonlyArray<string>): Promise<Array<Array<number>>> {
    const truncated = typeof input === 'string'
      ? truncateToContext(input, contextLength)
      : input.map((t) => truncateToContext(t, contextLength));

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, input: truncated }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    return data.data.map(d => d.embedding);
  }

  return {
    dimensions: config.dimensions,

    async embed(text: string): Promise<Array<number>> {
      const embeddings = await requestEmbeddings(text);
      const first = embeddings[0];
      if (!first) throw new Error('no embedding returned');
      return first;
    },

    async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
      return requestEmbeddings(texts);
    },
  };
}
