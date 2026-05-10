// pattern: Imperative Shell (test)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './loader.ts';

describe('loadConfig', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `config-test-${Math.random().toString(36).slice(2)}`);
    configPath = join(tempDir, 'config.toml');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
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
