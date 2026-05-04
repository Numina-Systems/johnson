// Unit tests for ingest_file tool — path resolution, security, and file reading

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { registerIngestTools } from './ingest.ts';
import { createToolRegistry, type ToolRegistry } from '../runtime/tool-registry.ts';
import { createStore } from '../store/store.ts';
import type { AgentDependencies } from '../agent/types.ts';

// Test fixture: temporary working directory with test files
let tempDir: string;
let testFilesDir: string;

beforeAll(async () => {
  tempDir = mkdtempSync('/tmp/ingest-test-');
  testFilesDir = tempDir;

  // Create test files
  await writeFile(join(testFilesDir, 'notes.md'), '# My Notes\nFact: Example content');

  // Create nested directory and file
  const subDir = join(testFilesDir, 'sub', 'dir');
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, 'file.md'), '# Nested File\nContent in subdirectory');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeDeps(workingDir: string): AgentDependencies {
  return {
    model: { complete: async () => { throw new Error('model not used in ingest tests'); } },
    runtime: {
      execute: async () => { throw new Error('runtime not used'); },
    } as unknown as AgentDependencies['runtime'],
    config: {
      model: 'test',
      maxTokens: 4096,
      maxToolRounds: 5,
      contextBudget: 0.7,
      contextLimit: 100_000,
      modelTimeout: 30_000,
      timezone: 'UTC',
    },
    personaPath: '/tmp/persona.md',
    store: createStore(':memory:'),
    workingDir,
  };
}

describe('ingest_file tool', () => {
  // ── Task 1: Path Resolution and Security Tests ──────────────────────────

  describe('AC1.1: Simple file path resolution', () => {
    test('resolves @/notes.md to workingDir/notes.md and reads content', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.content).toContain('# My Notes');
      expect(parsed.content).toContain('Fact: Example content');
      expect(parsed.tokenEstimate).toBeGreaterThan(0);
    });
  });

  describe('AC1.2: Nested path resolution', () => {
    test('resolves sub/dir/file.md correctly', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'sub/dir/file.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.content).toContain('# Nested File');
      expect(parsed.content).toContain('Content in subdirectory');
    });
  });

  describe('AC1.3: Path traversal rejection', () => {
    test('rejects path traversal attack (../../etc/passwd)', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      let error: unknown;
      try {
        await registry.execute('ingest_file', {
          path: '../../etc/passwd',
          intent: 'context',
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(String(error)).toMatch(/traversal|outside|workingDir/i);
    });
  });

  describe('AC1.4: Absolute path rejection', () => {
    test('rejects absolute path outside workingDir', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      let error: unknown;
      try {
        await registry.execute('ingest_file', {
          path: '/etc/passwd',
          intent: 'context',
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(String(error)).toMatch(/traversal|outside|workingDir/i);
    });
  });

  describe('Path normalization', () => {
    test('strips leading @ from path', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: '@/notes.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.content).toContain('# My Notes');
    });
  });

  describe('Tool registration shape', () => {
    test('registers ingest_file tool with correct schema', () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      // Tool should be registered and callable
      const ingestTool = registry.get('ingest_file');
      expect(ingestTool).toBeDefined();
      expect(ingestTool?.definition.name).toBe('ingest_file');
      expect(ingestTool?.definition.input_schema.properties.path).toBeDefined();
      expect(ingestTool?.definition.input_schema.properties.intent).toBeDefined();
    });
  });
});
