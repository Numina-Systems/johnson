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

  // ── Task 4: Intent Dispatch Tests ──────────────────────────────────────

  describe('AC2.1: Memory intent appends to self document', () => {
    test('appends file content to self document with memory intent', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'memory',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.content).toBe('Appended to self document');
      expect(parsed.tokenEstimate).toBeGreaterThan(0);

      // Verify the content was actually stored
      const selfDoc = deps.store.docGet('self');
      expect(selfDoc).toBeDefined();
      expect(selfDoc?.content).toContain('# My Notes');
      expect(selfDoc?.content).toContain('Fact: Example content');
    });
  });

  describe('AC2.3: Memory additions have separator for traceability', () => {
    test('includes <!-- from: filename --> separator in self document', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'memory',
      });

      const selfDoc = deps.store.docGet('self');
      expect(selfDoc?.content).toMatch(/<!-- from: notes\.md -->/);
    });
  });

  describe('AC3.1: Knowledge intent stores as knowledge:* document', () => {
    test('stores file as knowledge:<name> document', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'knowledge',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.rkey).toBe('knowledge:notes');
      expect(parsed.content).toBe('Stored as knowledge:notes');
      expect(parsed.tokenEstimate).toBeGreaterThan(0);

      // Verify the content was actually stored with the correct rkey
      const knowledgeDoc = deps.store.docGet('knowledge:notes');
      expect(knowledgeDoc).toBeDefined();
      expect(knowledgeDoc?.content).toContain('# My Notes');
      expect(knowledgeDoc?.content).toContain('Fact: Example content');
    });
  });

  describe('AC4.1: Context intent returns content without persistence', () => {
    test('returns file content for context intent, nothing persisted', async () => {
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
      expect(parsed.rkey).toBeUndefined();

      // Verify nothing was persisted
      const knowledgeDoc = deps.store.docGet('knowledge:notes');
      expect(knowledgeDoc).toBeNull();

      const selfDoc = deps.store.docGet('self');
      expect(selfDoc).toBeNull();
    });
  });

  describe('AC6.2: Embedding hooks fire for persisted documents', () => {
    test('calls embedding.embed() for memory intent', async () => {
      const deps = makeDeps(testFilesDir);
      let embeddingCalled = false;

      // Mock embedding provider
      deps.embedding = {
        embed: async (text: string) => {
          embeddingCalled = true;
          return new Float32Array([0.1, 0.2, 0.3]);
        },
      };

      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'memory',
      });

      expect(embeddingCalled).toBe(true);
    });

    test('calls embedding.embed() for knowledge intent', async () => {
      const deps = makeDeps(testFilesDir);
      let embeddingCalled = false;

      // Mock embedding provider
      deps.embedding = {
        embed: async (text: string) => {
          embeddingCalled = true;
          return new Float32Array([0.1, 0.2, 0.3]);
        },
      };

      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'knowledge',
      });

      expect(embeddingCalled).toBe(true);
    });

    test('does not call embedding.embed() for context intent', async () => {
      const deps = makeDeps(testFilesDir);
      let embeddingCalled = false;

      // Mock embedding provider
      deps.embedding = {
        embed: async (text: string) => {
          embeddingCalled = true;
          return new Float32Array([0.1, 0.2, 0.3]);
        },
      };

      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'context',
      });

      expect(embeddingCalled).toBe(false);
    });
  });

  describe('AC6.3: Result includes tokenEstimate field', () => {
    test('includes tokenEstimate in result for all intents', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const contextResult = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'context',
      });
      const contextParsed = JSON.parse(contextResult as string);
      expect(contextParsed.tokenEstimate).toBeGreaterThan(0);
      expect(typeof contextParsed.tokenEstimate).toBe('number');

      const memoryResult = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'memory',
      });
      const memoryParsed = JSON.parse(memoryResult as string);
      expect(memoryParsed.tokenEstimate).toBeGreaterThan(0);
      expect(typeof memoryParsed.tokenEstimate).toBe('number');

      const knowledgeResult = await registry.execute('ingest_file', {
        path: 'sub/dir/file.md',
        intent: 'knowledge',
      });
      const knowledgeParsed = JSON.parse(knowledgeResult as string);
      expect(knowledgeParsed.tokenEstimate).toBeGreaterThan(0);
      expect(typeof knowledgeParsed.tokenEstimate).toBe('number');
    });

    test('includes chunks field set to 0', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.chunks).toBe(0);
    });
  });
});
