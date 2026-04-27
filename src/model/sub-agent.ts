// pattern: Imperative Shell — minimal LLM client for tool-side single-shot calls

import Anthropic from '@anthropic-ai/sdk';
import type { SubModelConfig } from '../config/types.ts';
import type { ModelProvider } from './types.ts';

export type SubAgentLLM = {
  complete(prompt: string, system?: string): Promise<string>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

type ChatMessage = { role: 'system' | 'user'; content: string };

function buildMessages(prompt: string, system?: string): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push({ role: 'user', content: prompt });
  return msgs;
}

async function completeViaOpenAI(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  maxTokens: number,
  prompt: string,
  system: string | undefined,
): Promise<string> {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = {
    model,
    max_tokens: maxTokens,
    messages: buildMessages(prompt, system),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } finally {
    clearTimeout(timeoutId);
  }
}

async function completeViaOllama(
  baseUrl: string,
  model: string,
  maxTokens: number,
  prompt: string,
  system: string | undefined,
): Promise<string> {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/api/chat';

  const body = {
    model,
    messages: buildMessages(prompt, system),
    stream: false,
    options: { num_predict: maxTokens },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const json = (await res.json()) as { message?: { content?: string | null } };
    const content = json.message?.content;
    return typeof content === 'string' ? content : '';
  } finally {
    clearTimeout(timeoutId);
  }
}

async function completeViaAnthropic(
  apiKey: string | undefined,
  model: string,
  maxTokens: number,
  prompt: string,
  system: string | undefined,
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    fetch: (url, init) => globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], init as RequestInit),
  });

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) params.system = system;

  const response = await client.messages.create(params);

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function createSubAgent(config: Readonly<SubModelConfig>): SubAgentLLM {
  const { provider, name, maxTokens, baseUrl, apiKey } = config;

  return {
    async complete(prompt: string, system?: string): Promise<string> {
      try {
        if (provider === 'anthropic') {
          return await completeViaAnthropic(apiKey, name, maxTokens, prompt, system);
        }

        if (provider === 'ollama') {
          const url = baseUrl ?? 'http://localhost:11434';
          return await completeViaOllama(url, name, maxTokens, prompt, system);
        }

        if (provider === 'openai-compat' || provider === 'openrouter' || provider === 'lemonade') {
          if (!baseUrl) {
            throw new Error(`Sub-agent provider "${provider}" requires baseUrl`);
          }
          return await completeViaOpenAI(baseUrl, apiKey, name, maxTokens, prompt, system);
        }

        throw new Error(`Unknown sub-agent provider: ${provider}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Sub-agent (${provider}) call failed: ${message}`);
      }
    },
  };
}

/**
 * Fallback: wrap a `ModelProvider` so it satisfies the `SubAgentLLM` interface.
 * Used when no `[sub_model]` is configured — the main model handles utility calls.
 * Caps `max_tokens` at 8000 to keep these calls cheap.
 */
export function wrapMainModel(
  model: ModelProvider,
  modelName: string,
  maxTokens: number,
): SubAgentLLM {
  return {
    async complete(prompt: string, system?: string): Promise<string> {
      const response = await model.complete({
        messages: [{ role: 'user', content: prompt }],
        system,
        tools: [],
        model: modelName,
        max_tokens: Math.min(maxTokens, 8000),
      });
      return response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
    },
  };
}
