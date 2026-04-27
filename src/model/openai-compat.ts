// pattern: Imperative Shell

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

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: ReadonlyArray<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAIChoice = {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
};

type OpenAIResponse = {
  choices: Array<OpenAIChoice>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
};

function convertMessages(
  messages: ReadonlyArray<Message>,
  system: string | undefined,
): Array<OpenAIMessage> {
  const result: Array<OpenAIMessage> = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Process content blocks for this message
    // Collect text and tool_use blocks for assistant, tool_result for tool role
    if (msg.role === 'assistant') {
      const textParts: Array<string> = [];
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

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

      const openaiMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
      };
      if (toolCalls.length > 0) {
        openaiMsg.tool_calls = toolCalls;
      }
      result.push(openaiMsg);
    } else {
      // user role — may contain tool_result blocks
      const hasImages = msg.content.some((b) => b.type === 'image_url');

      if (hasImages) {
        // Build multimodal content parts array
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
        const toolResults: Array<OpenAIMessage> = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          } else if (block.type === 'image_url') {
            parts.push({ type: 'image_url', image_url: { url: block.image_url.url } });
          } else if (block.type === 'tool_result') {
            toolResults.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }

        if (parts.length > 0) {
          result.push({ role: 'user', content: parts });
        }
        result.push(...toolResults);
      } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          result.push({ role: 'user', content: block.text });
        } else if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
      }
    }
  }

  return result;
}

function convertTools(tools: ReadonlyArray<ToolDefinition>): Array<OpenAITool> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    default: return 'end_turn';
  }
}

function mapResponseContent(choice: OpenAIChoice): Array<ContentBlock> {
  const blocks: Array<ContentBlock> = [];

  if (choice.message.content) {
    blocks.push({ type: 'text', text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        // LLM emitted malformed JSON in tool arguments — try to salvage
        // Common issues: trailing commas, single quotes, unquoted keys
        const cleaned = tc.function.arguments
          .replace(/,\s*([}\]])/g, '$1')        // trailing commas
          .replace(/'/g, '"')                    // single → double quotes
          .replace(/(\w+)\s*:/g, '"$1":');       // unquote → quote keys
        try {
          parsed = JSON.parse(cleaned) as Record<string, unknown>;
        } catch {
          // Total failure — return error as a text block so the agent can retry
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

export function createOpenAICompatProvider(config: Readonly<ModelConfig>): ModelProvider {
  const apiKey = config.apiKey ?? process.env['OPENAI_COMPAT_API_KEY'];
  const baseUrl = config.baseUrl;

  if (!baseUrl) {
    throw new Error('openai-compat provider requires baseUrl in config or OPENAI_COMPAT_BASE_URL env var');
  }

  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  return {
    async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.max_tokens,
        messages: convertMessages(request.messages, request.system),
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = convertTools(request.tools);
      }

      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        request.timeout ?? 120_000,
      );

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenAI-compat API error ${res.status}: ${text}`);
        }

        let data: OpenAIResponse;
        try {
          const raw = await res.json();
          data = raw as OpenAIResponse;
        } catch (parseErr) {
          throw new Error(`OpenAI-compat API returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
        }

        if (!data?.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
          throw new Error(`OpenAI-compat API returned no choices. Response: ${JSON.stringify(data).slice(0, 500)}`);
        }

        const choice = data.choices[0]!;

        return {
          content: mapResponseContent(choice),
          stop_reason: mapFinishReason(choice.finish_reason),
          usage: {
            input_tokens: data.usage.prompt_tokens,
            output_tokens: data.usage.completion_tokens,
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
