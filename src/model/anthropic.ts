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

function mapContentBlock(block: Anthropic.ContentBlock): ContentBlock | null {
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
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return null;
  }
  // Fallback: treat unknown block types as text
  return { type: 'text', text: String((block as unknown as Record<string, unknown>)['text'] ?? '') };
}

const EPHEMERAL_CACHE = { type: 'ephemeral' as const };

/**
 * Convert messages for the API, marking the last content block of the
 * final message with cache_control so the conversation prefix is cached
 * incrementally across tool rounds and turns.
 */
function convertMessagesWithCache(
  messages: ReadonlyArray<ModelRequest['messages'][number]>,
): Anthropic.MessageCreateParams['messages'] {
  return messages.map((m, i) => {
    const isLast = i === messages.length - 1;
    if (!isLast) {
      return {
        role: m.role,
        content: m.content as Anthropic.MessageCreateParams['messages'][number]['content'],
      };
    }

    if (typeof m.content === 'string') {
      return {
        role: m.role,
        content: [{ type: 'text' as const, text: m.content, cache_control: EPHEMERAL_CACHE }],
      };
    }

    const blocks = m.content.map((block, j) =>
      j === m.content.length - 1 ? { ...block, cache_control: EPHEMERAL_CACHE } : block,
    );
    return {
      role: m.role,
      content: blocks as Anthropic.MessageCreateParams['messages'][number]['content'],
    };
  });
}

export function createAnthropicProvider(config: Readonly<ModelConfig>): ModelProvider {
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const client = new Anthropic({ apiKey, maxRetries: 3 });

  return {
    async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
      const params: Anthropic.MessageCreateParams = {
        model: request.model,
        max_tokens: request.max_tokens,
        messages: convertMessagesWithCache(request.messages),
      };

      if (request.system) {
        // Stable prefix gets a cache breakpoint; the volatile suffix
        // (time, recalled context) sits after it so it never invalidates
        // the cached prefix.
        const systemBlocks: Array<Anthropic.TextBlockParam> = [
          { type: 'text', text: request.system, cache_control: EPHEMERAL_CACHE },
        ];
        if (request.system_suffix) {
          systemBlocks.push({ type: 'text', text: request.system_suffix });
        }
        params.system = systemBlocks;
      } else if (request.system_suffix) {
        params.system = request.system_suffix;
      }

      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool['input_schema'],
          ...(i === request.tools!.length - 1 ? { cache_control: EPHEMERAL_CACHE } : {}),
        }));

        if (request.tool_choice) {
          params.tool_choice = { type: request.tool_choice };
        }
      }

      if (request.temperature !== undefined) {
        params.temperature = request.temperature;
      }

      const response = await client.messages.create(params, {
        timeout: request.timeout ?? 120_000,
      });

      const content: Array<ContentBlock> = response.content
        .map(mapContentBlock)
        .filter((b): b is ContentBlock => b !== null);

      const thinkingTexts = response.content
        .filter((b): b is Anthropic.ThinkingBlock => b.type === 'thinking')
        .map((b) => b.thinking);
      const reasoning_content = thinkingTexts.length > 0
        ? thinkingTexts.join('\n\n')
        : undefined;

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
        reasoning_content,
      };
    },
  };
}
