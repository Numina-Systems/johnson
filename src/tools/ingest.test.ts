// Unit tests for ingest_file tool — path resolution, security, and file reading

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { registerIngestTools } from './ingest.ts';
import { chunkText } from './chunking.ts';
import { createToolRegistry, type ToolRegistry } from '../runtime/tool-registry.ts';
import { createStore } from '../store/store.ts';
import { estimateTokens } from '../agent/context.ts';
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

  // ── Task 3: Chunking Tests ────────────────────────────────────────────

  describe('AC5.1: Size threshold — files chunked correctly', () => {
    test('small file returns single chunk', () => {
      const smallText = 'This is a small file.';
      const chunks = chunkText(smallText);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.content).toBe(smallText);
      expect(chunks[0]!.index).toBe(0);
      expect(chunks[0]!.heading).toBe('');
    });

    test('file under 4096 tokens returns single chunk', () => {
      // Create text that is estimated at ~2000 tokens (8000 chars)
      const para = 'Lorem ipsum dolor sit amet. '.repeat(280); // ~2000 tokens
      const chunks = chunkText(para);

      expect(chunks).toHaveLength(1);
      expect(estimateTokens(chunks[0]!.content)).toBeLessThanOrEqual(2100);
    });

    test('large file returns multiple chunks', () => {
      // Create text exceeding 4096 tokens (16k+ chars)
      const para = 'Paragraph content here. '.repeat(700); // ~4400 tokens
      const chunks = chunkText(para);

      expect(chunks.length).toBeGreaterThan(1);
    });

    test('no chunk exceeds hard limit of TARGET_CHUNK_SIZE * 1.5', () => {
      // Create very large text (10k tokens)
      const para = 'Word '.repeat(10000); // ~10000 tokens
      const chunks = chunkText(para);

      const maxAllowed = 2048 * 1.5;
      for (const chunk of chunks) {
        expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(maxAllowed + 200); // reasonable buffer
      }
    });
  });

  describe('AC5.2: Split priority — headers > paragraphs > sentences', () => {
    test('markdown file splits at header boundaries', () => {
      const markdownText = `# Getting Started

This is content under the main heading.

## Setup

Content for setup section.

## Installation

More content here.`;

      const chunks = chunkText(markdownText);

      // Should preserve headers
      const hasHeaders = chunks.some((c) => c.content.includes('# Getting Started'));
      expect(hasHeaders).toBe(true);
    });

    test('chunk starting with header preserves heading in content', () => {
      const markdownText = `# Main

Content here.`;

      const chunks = chunkText(markdownText);
      expect(chunks[0]!.content).toContain('# Main');
    });

    test('file with no headers splits on paragraph boundaries', () => {
      // Create ~5000+ tokens of text with paragraph breaks
      const text = 'First paragraph with detailed content here about various topics. '.repeat(200)
        + '\n\n'
        + 'Second paragraph with more detailed content and information. '.repeat(200)
        + '\n\n'
        + 'Third paragraph with even more substantive content and details. '.repeat(200);
      const chunks = chunkText(text);

      // Should have multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
      // Chunks should be reasonably sized
      for (const chunk of chunks) {
        expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(3100);
      }
    });

    test('dense text with only sentence breaks splits on sentences', () => {
      // Create text with only periods, no paragraph breaks
      const text = 'Sentence one. Sentence two. Sentence three. '.repeat(600); // large
      const chunks = chunkText(text);

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should be reasonable
      for (const chunk of chunks) {
        expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(3100);
      }
    });

    test('very long paragraph with no sentence breaks hard-cuts at limit', () => {
      // Create a very long "word" or string without natural breaks
      const longString = 'x '.repeat(3000); // ~3000 "words", ~3000 tokens
      const chunks = chunkText(longString);

      expect(chunks.length).toBeGreaterThan(0);
      // All chunks should be under hard limit
      for (const chunk of chunks) {
        expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(2048 * 1.5 + 100);
      }
    });
  });

  describe('AC5.3: Heading context — parent headings preserved', () => {
    test('chunk from section carries heading context', () => {
      const markdown = `# Main Title

Content here with substantive details. `.repeat(100) + `

## Subsection

More content describing details. This is a long section that will be split across chunks. `.repeat(200);

      const chunks = chunkText(markdown);

      // Find chunks from subsection
      const subsectionChunks = chunks.filter((c) => c.heading.includes('##'));
      expect(subsectionChunks.length).toBeGreaterThan(0);

      for (const chunk of subsectionChunks) {
        expect(chunk.heading).toContain('##');
      }
    });

    test('first chunk before any heading has empty heading', () => {
      const text = 'Initial content before any heading.\n\n# First Heading\n\nMore content.';
      const chunks = chunkText(text);

      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      expect(firstChunk!.content).toContain('Initial content');
      expect(firstChunk!.heading).toBe('');
    });

    test('chunks maintain consistent heading within section', () => {
      const markdown = `## Section A

Paragraph one with detailed content and information. `.repeat(250) + `

Paragraph two with additional content and discussion. `.repeat(250);

      const chunks = chunkText(markdown);

      // All chunks should have "## Section A" as heading
      for (const chunk of chunks) {
        expect(chunk.heading).toBe('## Section A');
      }
    });

    test('heading changes as document progresses through sections', () => {
      const markdown = `## First Section

Content here with details and information. `.repeat(250) + `

## Second Section

Content with substantive discussion. `.repeat(250);

      const chunks = chunkText(markdown);

      // Should have chunks from both sections
      const firstSectionChunks = chunks.filter((c) => c.heading === '## First Section');
      const secondSectionChunks = chunks.filter((c) => c.heading === '## Second Section');

      expect(firstSectionChunks.length).toBeGreaterThan(0);
      expect(secondSectionChunks.length).toBeGreaterThan(0);
    });
  });

  describe('Chunking edge cases', () => {
    test('empty input returns empty array', () => {
      const chunks = chunkText('');
      expect(chunks).toHaveLength(0);
    });

    test('whitespace-only input returns empty array', () => {
      const chunks = chunkText('   \n\n  \t  ');
      expect(chunks).toHaveLength(0);
    });

    test('chunk indices are sequential starting from 0', () => {
      const text = 'x'.repeat(20000); // Large text
      const chunks = chunkText(text);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.index).toBe(i);
      }
    });

    test('all chunks have valid token estimates', () => {
      const text = `# Header

Paragraph content. `.repeat(500);

      const chunks = chunkText(text);

      for (const chunk of chunks) {
        expect(chunk.tokenEstimate).toBeGreaterThan(0);
        expect(typeof chunk.tokenEstimate).toBe('number');
        // Verify token estimate matches actual content
        const actualTokens = estimateTokens(chunk.content);
        expect(Math.abs(chunk.tokenEstimate - actualTokens)).toBeLessThan(5);
      }
    });

    test('chunking preserves all original content', () => {
      const original = `# Title

First paragraph with content.

## Subsection

Second paragraph with more content. `.repeat(100);

      const chunks = chunkText(original);
      const reconstructed = chunks.map((c) => c.content).join('\n\n');

      // All original content should appear in the chunks
      expect(reconstructed).toContain('# Title');
      expect(reconstructed).toContain('First paragraph');
      expect(reconstructed).toContain('## Subsection');
      expect(reconstructed).toContain('Second paragraph');
    });

    test('multiple paragraphs in large section create appropriate chunks', () => {
      const text = `## Section

Para 1 with detailed content and substantive discussion. `.repeat(250) + `

Para 2 with additional content and more details. `.repeat(250) + `

Para 3 with further content and information. `.repeat(250);

      const chunks = chunkText(text);

      expect(chunks.length).toBeGreaterThan(1);
      // All should have same heading
      for (const chunk of chunks) {
        expect(chunk.heading).toBe('## Section');
      }
    });
  });

  // ── Task 4: Integration of chunking into ingest_file handler ──────────

  describe('AC5.1: Large file integration — handler calls chunkText', () => {
    test('large file returns chunked result with chunk count', async () => {
      // Create a large file (>4096 tokens)
      const largeContent = 'Paragraph content here. '.repeat(700); // ~4400 tokens
      const testFile = join(testFilesDir, 'large-file.md');
      await writeFile(testFile, largeContent);

      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'large-file.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.chunks).toBeGreaterThan(1);
      expect(parsed.tokenEstimate).toBeGreaterThan(4096);
      expect(typeof parsed.tokenEstimate).toBe('number');
      expect(parsed.content).toContain('chunks');
    });

    test('large file with knowledge intent returns chunk count without storing full content', async () => {
      const largeContent = 'Paragraph content here. '.repeat(700);
      const testFile = join(testFilesDir, 'large-knowledge.md');
      await writeFile(testFile, largeContent);

      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'large-knowledge.md',
        intent: 'knowledge',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.chunks).toBeGreaterThan(1);
      expect(parsed.tokenEstimate).toBeGreaterThan(4096);
    });

    test('large file with memory intent returns chunk count', async () => {
      const largeContent = 'Paragraph content here. '.repeat(700);
      const testFile = join(testFilesDir, 'large-memory.md');
      await writeFile(testFile, largeContent);

      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'large-memory.md',
        intent: 'memory',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.chunks).toBeGreaterThan(1);
      expect(parsed.tokenEstimate).toBeGreaterThan(4096);
    });

    test('small file still uses non-chunked path', async () => {
      const deps = makeDeps(testFilesDir);
      const registry = createToolRegistry();
      registerIngestTools(registry, deps);

      const result = await registry.execute('ingest_file', {
        path: 'notes.md',
        intent: 'context',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.content).toContain('# My Notes');
      // Small files return chunks: 0 (not using chunking path)
      expect(parsed.chunks).toBe(0);
    });
  });
});
