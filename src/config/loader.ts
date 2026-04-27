// pattern: Imperative Shell

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import TOML from 'toml';
import type { AppConfig, ModelConfig, RuntimeConfig, AgentLoopConfig, EmbeddingConfig, DiscordConfig, InterfaceMode } from './types.ts';

type RawConfig = {
  model?: Partial<ModelConfig> & Record<string, unknown>;
  runtime?: Partial<RuntimeConfig> & Record<string, unknown>;
  agent?: Partial<AgentLoopConfig> & Record<string, unknown>;
  embedding?: Partial<EmbeddingConfig> & Record<string, unknown>;
  discord?: Partial<DiscordConfig> & Record<string, unknown>;
  interface?: string;
};

const DEFAULT_MODEL: ModelConfig = {
  provider: 'anthropic',
  name: 'claude-sonnet-4-20250514',
  maxTokens: 16384,
};

const DEFAULT_RUNTIME: RuntimeConfig = {
  workingDir: '.',
  allowedHosts: [],
  timeoutMs: 120_000,
  maxCodeSize: 1_000_000,
  maxOutputSize: 100_000,
  unrestricted: false,
};

const DEFAULT_AGENT: AgentLoopConfig = {
  maxToolRounds: 50,
  contextBudget: 200_000,
  contextLimit: 160_000,
  modelTimeout: 300_000,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function resolveApiKey(provider: string, explicit: string | undefined): string | undefined {
  if (explicit) return explicit;
  if (provider === 'anthropic') return process.env['ANTHROPIC_API_KEY'];
  if (provider === 'openai-compat') return process.env['OPENAI_COMPAT_API_KEY'];
  if (provider === 'lemonade') return process.env['LEMONADE_API_KEY'] ?? 'lemonade';
  if (provider === 'openrouter') return process.env['OPENROUTER_API_KEY'];
  return undefined;
}

function resolveBaseUrl(provider: string, explicit: string | undefined): string | undefined {
  if (explicit) return explicit;
  if (provider === 'openai-compat') return process.env['OPENAI_COMPAT_BASE_URL'];
  if (provider === 'ollama') return process.env['OLLAMA_BASE_URL'];
  if (provider === 'lemonade') return process.env['LEMONADE_BASE_URL'];
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  return undefined;
}

/** Look up a config key, accepting both snake_case and camelCase from TOML */
function pick<T>(obj: Record<string, unknown> | undefined, camelKey: string, fallback: T): T {
  if (!obj) return fallback;
  if (camelKey in obj && obj[camelKey] !== undefined) return obj[camelKey] as T;
  const snakeKey = camelKey.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  if (snakeKey in obj && obj[snakeKey] !== undefined) return obj[snakeKey] as T;
  return fallback;
}

export function loadConfig(configPath: string): AppConfig {
  const raw = TOML.parse(readFileSync(configPath, 'utf-8')) as RawConfig;
  const configDir = dirname(resolve(configPath));

  const provider = pick(raw.model, 'provider', DEFAULT_MODEL.provider);

  const model: ModelConfig = {
    provider,
    name: pick(raw.model, 'name', DEFAULT_MODEL.name),
    maxTokens: pick(raw.model, 'maxTokens', DEFAULT_MODEL.maxTokens),
    apiKey: resolveApiKey(provider, pick(raw.model, 'apiKey', undefined)),
    baseUrl: resolveBaseUrl(provider, pick(raw.model, 'baseUrl', undefined)),
  };

  const rawWorkingDir = pick(raw.runtime, 'workingDir', DEFAULT_RUNTIME.workingDir);
  const runtime: RuntimeConfig = {
    workingDir: resolve(configDir, rawWorkingDir),
    allowedHosts: pick(raw.runtime, 'allowedHosts', DEFAULT_RUNTIME.allowedHosts),
    timeoutMs: pick(raw.runtime, 'timeoutMs', DEFAULT_RUNTIME.timeoutMs),
    maxCodeSize: pick(raw.runtime, 'maxCodeSize', DEFAULT_RUNTIME.maxCodeSize),
    maxOutputSize: pick(raw.runtime, 'maxOutputSize', DEFAULT_RUNTIME.maxOutputSize),
    unrestricted: pick(raw.runtime, 'unrestricted', DEFAULT_RUNTIME.unrestricted),
  };

  const agent: AgentLoopConfig = {
    maxToolRounds: pick(raw.agent, 'maxToolRounds', DEFAULT_AGENT.maxToolRounds),
    contextBudget: pick(raw.agent, 'contextBudget', DEFAULT_AGENT.contextBudget),
    contextLimit: pick(raw.agent, 'contextLimit', DEFAULT_AGENT.contextLimit),
    modelTimeout: pick(raw.agent, 'modelTimeout', DEFAULT_AGENT.modelTimeout),
    timezone: pick(raw.agent, 'timezone', DEFAULT_AGENT.timezone),
  };

  const embeddingProvider = pick(raw.embedding, 'provider', 'ollama');
  const embedding: EmbeddingConfig = {
    provider: embeddingProvider,
    model: pick(raw.embedding, 'model', 'nomic-embed-text'),
    dimensions: pick(raw.embedding, 'dimensions', 768),
    endpoint: process.env['EMBEDDING_ENDPOINT'] ?? pick(raw.embedding, 'endpoint', undefined),
  };

  // Discord config (optional — only needed when interface includes discord)
  const discordToken = process.env['DISCORD_BOT_TOKEN'] ?? pick(raw.discord, 'token', undefined);
  const discord: DiscordConfig | undefined = discordToken
    ? {
        token: discordToken,
        allowedChannels: pick(raw.discord, 'allowedChannels', undefined),
        allowedUsers: pick(raw.discord, 'allowedUsers', undefined),
        prefix: pick(raw.discord, 'prefix', '!'),
      }
    : undefined;

  const rawInterface = raw.interface ?? 'tui';
  const interfaceMode: InterfaceMode =
    rawInterface === 'discord' || rawInterface === 'both' ? rawInterface : 'tui';

  return { model, runtime, agent, embedding, discord, interface: interfaceMode };
}
