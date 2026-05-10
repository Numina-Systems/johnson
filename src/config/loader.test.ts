// pattern: Imperative Shell (test) — config loader [sub_model] and archivist parsing

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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

describe('loadConfig — [archivist] parsing', () => {
  let tempDir2: string;
  let configPath: string;

  beforeEach(() => {
    tempDir2 = join(tmpdir(), `config-test-${Math.random().toString(36).slice(2)}`);
    configPath = join(tempDir2, 'config.toml');
    mkdirSync(tempDir2, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir2, { recursive: true, force: true });
    } catch {}
  });

  function writeConfig(content: string): void {
    writeFileSync(configPath, content);
  }

  function getMinimalConfig(): string {
    return `
interface = "tui"

[model]
provider = "lemonade"
name = "test-model"
max_tokens = 8192
base_url = "http://localhost:8080/v1"

[agent]
max_tool_rounds = 50
context_budget = 200000
context_limit = 160000
model_timeout = 300000

[runtime]
working_dir = "."
timeout_ms = 30000
max_code_size = 100000
max_output_size = 500000
unrestricted = true

[embedding]
provider = "ollama"
model = "nomic-embed-text"
dimensions = 768
endpoint = "http://localhost:11434"
`;
  }

  test('archivist.AC1.5: when [archivist] section is absent, config.archivist is undefined', () => {
    const content = getMinimalConfig();
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist).toBeUndefined();
  });

  test('when [archivist] section is present with enabled = true, all fields are parsed with correct defaults', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist).toBeDefined();
    expect(config.archivist?.enabled).toBe(true);
    expect(config.archivist?.daytimeSchedule).toBe('0 6-22 * * *');
    expect(config.archivist?.nighttimeSchedule).toBe('0 2 * * *');
    expect(config.archivist?.dedupThreshold).toBe(0.88);
    expect(config.archivist?.crossrefThreshold).toBe(0.60);
    expect(config.archivist?.pruneThreshold).toBe(0.92);
    expect(config.archivist?.tokenBudget).toBe(0);
    expect(config.archivist?.maxLogEntries).toBe(30);
  });

  test('when enabled = false, config.archivist is undefined', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = false
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist).toBeUndefined();
  });

  test('snake_case keys are accepted and mapped to camelCase (daytime_schedule)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
daytime_schedule = "0 9-17 * * *"
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.daytimeSchedule).toBe('0 9-17 * * *');
  });

  test('snake_case keys are accepted and mapped to camelCase (nighttime_schedule)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
nighttime_schedule = "0 3 * * *"
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.nighttimeSchedule).toBe('0 3 * * *');
  });

  test('snake_case keys are accepted and mapped to camelCase (dedup_threshold)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
dedup_threshold = 0.95
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.dedupThreshold).toBe(0.95);
  });

  test('snake_case keys are accepted and mapped to camelCase (crossref_threshold)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
crossref_threshold = 0.75
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.crossrefThreshold).toBe(0.75);
  });

  test('snake_case keys are accepted and mapped to camelCase (prune_threshold)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
prune_threshold = 0.85
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.pruneThreshold).toBe(0.85);
  });

  test('snake_case keys are accepted and mapped to camelCase (token_budget)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
token_budget = 5000
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.tokenBudget).toBe(5000);
  });

  test('snake_case keys are accepted and mapped to camelCase (max_log_entries)', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
max_log_entries = 50
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist?.maxLogEntries).toBe(50);
  });

  test('all archivist fields can be overridden together', () => {
    const content = getMinimalConfig() + `
[archivist]
enabled = true
daytime_schedule = "0 8-20 * * *"
nighttime_schedule = "0 1 * * *"
dedup_threshold = 0.90
crossref_threshold = 0.65
prune_threshold = 0.95
token_budget = 10000
max_log_entries = 100
`;
    writeConfig(content);

    const config = loadConfig(configPath);

    expect(config.archivist).toBeDefined();
    expect(config.archivist?.enabled).toBe(true);
    expect(config.archivist?.daytimeSchedule).toBe('0 8-20 * * *');
    expect(config.archivist?.nighttimeSchedule).toBe('0 1 * * *');
    expect(config.archivist?.dedupThreshold).toBe(0.90);
    expect(config.archivist?.crossrefThreshold).toBe(0.65);
    expect(config.archivist?.pruneThreshold).toBe(0.95);
    expect(config.archivist?.tokenBudget).toBe(10000);
    expect(config.archivist?.maxLogEntries).toBe(100);
  });
});
