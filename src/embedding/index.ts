// pattern: Imperative Shell (barrel + factory)

export type { EmbeddingProvider } from './types.ts';
export { createOllamaEmbedding } from './ollama.ts';
export { createOpenAICompatEmbedding } from './openai-compat.ts';

import type { EmbeddingConfig } from '../config/types.ts';
import type { EmbeddingProvider } from './types.ts';
import { createOllamaEmbedding } from './ollama.ts';
import { createOpenAICompatEmbedding } from './openai-compat.ts';

export function createEmbeddingProvider(config: Readonly<EmbeddingConfig>): EmbeddingProvider {
  switch (config.provider) {
    case 'ollama':
      return createOllamaEmbedding(config);
    case 'openai-compat':
    case 'lemonade':
      return createOpenAICompatEmbedding(config);
    default:
      throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
  }
}
