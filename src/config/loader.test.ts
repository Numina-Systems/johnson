// pattern: Imperative Shell (test) — config loader [sub_model] parsing

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './loader.ts';

let tempDir: string;
const SUB_MODEL_ENV_KEYS = [
  'SUB_MODEL_API_KEY',
  'SUB_MODEL_PROVIDER',
  'SUB_MODEL_NAME',
  'SUB_MODEL_BASE_URL',
] as const;

function writeTempConfig(toml: string): string {
  const path = join(tempDir, `config-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
  writeFileSync(path, toml);
  return path;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
  for (const k of SUB_MODEL_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  for (const k of SUB_MODEL_ENV_KEYS) delete process.env[k];
});

const BASE_TOML = `
[model]
provider = "anthropic"
name = "claude-sonnet-4-20250514"
max_tokens = 16384
api_key = "main-key"
`;

describe('loadConfig — [sub_model] parsing', () => {
  test('returns undefined subModel when [sub_model] section is absent', () => {
    const path = writeTempConfig(BASE_TOML);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel).toBeUndefined();
    } finally {
      unlinkSync(path);
    }
  });

  test('parses full [sub_model] section', () => {
    const path = writeTempConfig(`
${BASE_TOML}

[sub_model]
provider = "anthropic"
name = "claude-haiku-4-5-20251001"
max_tokens = 4000
api_key = "toml-key"
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel).toBeDefined();
      expect(cfg.subModel!.provider).toBe('anthropic');
      expect(cfg.subModel!.name).toBe('claude-haiku-4-5-20251001');
      expect(cfg.subModel!.maxTokens).toBe(4000);
      expect(cfg.subModel!.apiKey).toBe('toml-key');
    } finally {
      unlinkSync(path);
    }
  });

  test('SUB_MODEL_API_KEY env var overrides TOML api_key', () => {
    process.env['SUB_MODEL_API_KEY'] = 'env-key';
    const path = writeTempConfig(`
${BASE_TOML}

[sub_model]
provider = "anthropic"
name = "claude-haiku-4-5-20251001"
api_key = "toml-key"
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel!.apiKey).toBe('env-key');
    } finally {
      unlinkSync(path);
    }
  });

  test('OpenRouter sub-model gets default base URL when not set', () => {
    const path = writeTempConfig(`
${BASE_TOML}

[sub_model]
provider = "openrouter"
name = "meta-llama/llama-3-8b"
api_key = "or-key"
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel!.baseUrl).toBe('https://openrouter.ai/api/v1');
    } finally {
      unlinkSync(path);
    }
  });

  test('SUB_MODEL_PROVIDER env var creates sub-model when TOML lacks one', () => {
    process.env['SUB_MODEL_PROVIDER'] = 'anthropic';
    process.env['SUB_MODEL_NAME'] = 'claude-haiku-from-env';
    process.env['SUB_MODEL_API_KEY'] = 'env-only-key';

    const path = writeTempConfig(BASE_TOML);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel).toBeDefined();
      expect(cfg.subModel!.provider).toBe('anthropic');
      expect(cfg.subModel!.name).toBe('claude-haiku-from-env');
      expect(cfg.subModel!.apiKey).toBe('env-only-key');
    } finally {
      unlinkSync(path);
    }
  });

  test('default name applies when TOML omits name', () => {
    const path = writeTempConfig(`
${BASE_TOML}

[sub_model]
provider = "anthropic"
api_key = "k"
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel!.name).toBe('claude-haiku-4-5-20251001');
    } finally {
      unlinkSync(path);
    }
  });

  test('default maxTokens (8000) applies when TOML omits max_tokens', () => {
    const path = writeTempConfig(`
${BASE_TOML}

[sub_model]
provider = "anthropic"
api_key = "k"
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.subModel!.maxTokens).toBe(8000);
    } finally {
      unlinkSync(path);
    }
  });
});
