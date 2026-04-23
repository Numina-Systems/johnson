// pattern: Imperative Shell

import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig } from '../config/types.ts';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ContentBlock,
  StopReason,
} from './types.ts';

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn': return 'end_turn';
    case 'tool_use': return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: return 'end_turn';
  }
}

function mapContentBlock(block: Anthropic.ContentBlock): ContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  // Fallback: treat unknown block types as text
  return { type: 'text', text: String((block as unknown as Record<string, unknown>)['text'] ?? '') };
}

export function createAnthropicProvider(config: Readonly<ModelConfig>): ModelProvider {
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const client = new Anthropic({ apiKey, maxRetries: 3 });

  return {
    async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
      const params: Anthropic.MessageCreateParams = {
        model: request.model,
        max_tokens: request.max_tokens,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content as Anthropic.MessageCreateParams['messages'][number]['content'],
        })),
      };

      if (request.system) {
        params.system = request.system;
      }

      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool['input_schema'],
        }));
      }

      if (request.temperature !== undefined) {
        params.temperature = request.temperature;
      }

      const response = await client.messages.create(params, {
        timeout: request.timeout ?? 120_000,
      });

      const content: Array<ContentBlock> = response.content.map(mapContentBlock);

      return {
        content,
        stop_reason: mapStopReason(response.stop_reason),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_creation_input_tokens:
            (response.usage as unknown as Record<string, unknown>)['cache_creation_input_tokens'] as
              number | null | undefined ?? null,
          cache_read_input_tokens:
            (response.usage as unknown as Record<string, unknown>)['cache_read_input_tokens'] as
              number | null | undefined ?? null,
        },
      };
    },
  };
}
