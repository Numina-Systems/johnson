// pattern: Imperative Shell

import { randomUUID } from 'node:crypto';
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

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
};

type OllamaTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaResponse = {
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done_reason: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

const DEFAULT_BASE_URL = 'http://localhost:11434';
const MAX_RETRIES = 3;
const RETRYABLE_CODES = new Set([429, 500, 502]);
const RETRYABLE_MESSAGES = ['ECONNREFUSED', 'fetch failed'];

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    return RETRYABLE_MESSAGES.some((msg) => error.message.includes(msg));
  }
  return false;
}

function convertMessages(
  messages: ReadonlyArray<Message>,
  system: string | undefined,
): Array<OllamaMessage> {
  const result: Array<OllamaMessage> = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts: Array<string> = [];
      const toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            function: {
              name: block.name,
              arguments: block.input,
            },
          });
        }
      }

      const ollamaMsg: OllamaMessage = {
        role: 'assistant',
        content: textParts.join('\n'),
      };
      if (toolCalls.length > 0) {
        ollamaMsg.tool_calls = toolCalls;
      }
      result.push(ollamaMsg);
    } else {
      // user role — may contain tool_result blocks
      for (const block of msg.content) {
        if (block.type === 'text') {
          result.push({ role: 'user', content: block.text });
        } else if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            content: block.content,
          });
        }
      }
    }
  }

  return result;
}

function convertTools(tools: ReadonlyArray<ToolDefinition>): Array<OllamaTool> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function mapStopReason(doneReason: string, hasToolCalls: boolean): StopReason {
  if (doneReason === 'length') return 'max_tokens';
  if (hasToolCalls) return 'tool_use';
  return 'end_turn';
}

function mapResponseContent(message: OllamaResponse['message']): Array<ContentBlock> {
  const blocks: Array<ContentBlock> = [];

  if (message.content) {
    blocks.push({ type: 'text', text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: randomUUID(),
        name: tc.function.name,
        input: tc.function.arguments,
      });
    }
  }

  return blocks;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createOllamaProvider(config: Readonly<ModelConfig>): ModelProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/chat`;

  return {
    async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: convertMessages(request.messages, request.system),
        stream: false,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = convertTools(request.tools);
      }

      const options: Record<string, unknown> = {};
      if (request.temperature !== undefined) {
        options.temperature = request.temperature;
      }
      if (request.max_tokens !== undefined) {
        options.num_predict = request.max_tokens;
      }
      if (Object.keys(options).length > 0) {
        body.options = options;
      }

      const timeoutMs = request.timeout ?? 120_000;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (!res.ok) {
            if (attempt < MAX_RETRIES && RETRYABLE_CODES.has(res.status)) {
              await sleep(1000 * 2 ** attempt);
              continue;
            }
            const text = await res.text();
            throw new Error(`Ollama API error ${res.status}: ${text}`);
          }

          const data = (await res.json()) as OllamaResponse;
          const hasToolCalls = (data.message.tool_calls?.length ?? 0) > 0;

          return {
            content: mapResponseContent(data.message),
            stop_reason: mapStopReason(data.done_reason, hasToolCalls),
            usage: {
              input_tokens: data.prompt_eval_count ?? 0,
              output_tokens: data.eval_count ?? 0,
            },
          };
        } catch (error: unknown) {
          if (attempt < MAX_RETRIES && isRetryable(error)) {
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          throw error;
        }
      }

      // Unreachable but satisfies TypeScript
      throw new Error('Ollama API: max retries exceeded');
    },
  };
}
