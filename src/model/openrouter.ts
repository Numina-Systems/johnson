// pattern: Imperative Shell

import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatMessages,
  ChatAssistantMessage,
  ChatFunctionToolFunction,
  ChatResult,
  ChatToolCall,
} from '@openrouter/sdk/models';
import type { ModelConfig } from '../config/types.ts';
import type {
  ContentBlock,
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StopReason,
  ToolDefinition,
} from './types.ts';

function convertMessages(
  messages: ReadonlyArray<Message>,
  system: string | undefined,
): Array<ChatMessages> {
  const result: Array<ChatMessages> = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      if (msg.role === 'assistant') {
        result.push({ role: 'assistant', content: msg.content });
      } else {
        result.push({ role: 'user', content: msg.content });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts: Array<string> = [];
      const toolCalls: Array<ChatToolCall> = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      const assistantMsg: ChatAssistantMessage & { role: 'assistant' } = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : undefined,
      };
      if (toolCalls.length > 0) {
        assistantMsg.toolCalls = toolCalls;
      }
      result.push(assistantMsg);
    } else {
      const hasImages = msg.content.some((b) => b.type === 'image_url');

      if (hasImages) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          } else if (block.type === 'image_url') {
            parts.push({ type: 'image_url', image_url: { url: block.image_url.url } });
          } else if (block.type === 'tool_result') {
            result.push({
              role: 'tool',
              toolCallId: block.tool_use_id,
              content: block.content,
            });
          }
        }

        if (parts.length > 0) {
          result.push({ role: 'user', content: parts as any });
        }
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            result.push({ role: 'user', content: block.text });
          } else if (block.type === 'tool_result') {
            result.push({
              role: 'tool',
              toolCallId: block.tool_use_id,
              content: block.content,
            });
          }
        }
      }
    }
  }

  return result;
}

function convertTools(
  tools: ReadonlyArray<ToolDefinition>,
): Array<ChatFunctionToolFunction> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function mapFinishReason(reason: string | null): StopReason {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    default: return 'end_turn';
  }
}

function mapResponseContent(
  message: ChatAssistantMessage,
): Array<ContentBlock> {
  const blocks: Array<ContentBlock> = [];

  if (message.content && typeof message.content === 'string') {
    blocks.push({ type: 'text', text: message.content });
  }

  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        const cleaned = tc.function.arguments
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/'/g, '"')
          .replace(/(\w+)\s*:/g, '"$1":');
        try {
          parsed = JSON.parse(cleaned) as Record<string, unknown>;
        } catch {
          blocks.push({
            type: 'text',
            text: `[Tool call parse error] "${tc.function.name}" received malformed arguments: ${tc.function.arguments.slice(0, 500)}`,
          });
          continue;
        }
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsed,
      });
    }
  }

  return blocks;
}

export function createOpenRouterProvider(config: Readonly<ModelConfig>): ModelProvider {
  const apiKey = config.apiKey ?? process.env['OPENROUTER_API_KEY'];

  if (!apiKey) {
    throw new Error('openrouter provider requires apiKey in config or OPENROUTER_API_KEY env var');
  }

  const client = new OpenRouter({ apiKey });
  const reasoningEffort = config.reasoning ?? 'none';

  return {
    async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
      const messages = convertMessages(request.messages, request.system);

      const chatRequest: Record<string, unknown> = {
        model: request.model,
        messages,
        maxTokens: request.max_tokens,
        reasoning: { effort: reasoningEffort },
      };

      if (request.tools && request.tools.length > 0) {
        chatRequest.tools = convertTools(request.tools);
      }

      if (request.temperature !== undefined) {
        chatRequest.temperature = request.temperature;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        request.timeout ?? 120_000,
      );

      try {
        let response: ChatResult;
        try {
          response = await client.chat.send(
            { chatRequest: { ...chatRequest, stream: false } as any },
            { fetchOptions: { signal: controller.signal } },
          ) as ChatResult;
        } catch (err: unknown) {
          const detail = err instanceof Error
            ? (err as any).body ?? (err as any).rawResponse ?? err.message
            : err;
          throw new Error(`OpenRouter API error: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
        }

        const choice = response.choices[0];
        if (!choice) {
          throw new Error('OpenRouter API returned no choices');
        }

        process.stderr.write(`[openrouter] finish_reason=${choice.finishReason} tool_calls=${choice.message.toolCalls?.length ?? 0} content_len=${typeof choice.message.content === 'string' ? choice.message.content.length : 0}\n`);

        const reasoning_content = typeof choice.message.reasoning === 'string' && choice.message.reasoning.length > 0
          ? choice.message.reasoning
          : undefined;

        return {
          content: mapResponseContent(choice.message),
          stop_reason: mapFinishReason(choice.finishReason),
          usage: {
            input_tokens: response.usage?.promptTokens ?? 0,
            output_tokens: response.usage?.completionTokens ?? 0,
          },
          reasoning_content,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
