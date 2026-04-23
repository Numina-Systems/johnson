// pattern: Imperative Shell — barrel export + factory

import type { ModelConfig } from '../config/types.ts';
import type { ModelProvider } from './types.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatProvider } from './openai-compat.ts';
import { createOllamaProvider } from './ollama.ts';

export { createAnthropicProvider } from './anthropic.ts';
export { createOpenAICompatProvider } from './openai-compat.ts';
export { createOllamaProvider } from './ollama.ts';

export function createModelProvider(config: Readonly<ModelConfig>): ModelProvider {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai-compat':
      return createOpenAICompatProvider(config);
    case 'ollama':
      return createOllamaProvider(config);
    case 'lemonade':
      return createOpenAICompatProvider({
        ...config,
        provider: 'openai-compat',
        baseUrl: config.baseUrl ?? 'http://localhost:13305/api/v1',
        apiKey: config.apiKey ?? 'lemonade',
      });
    default:
      throw new Error(`Unknown model provider: ${(config as Record<string, unknown>).provider}`);
  }
}
