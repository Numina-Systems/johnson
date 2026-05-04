// pattern: Imperative Shell — ingest_file tool handler with file I/O and path resolution

import { resolve } from 'node:path';
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { estimateTokens } from '../agent/context.ts';

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

// ── Chunking Types and Constants ────────────────────────────────────────

type Chunk = {
  readonly index: number;
  readonly content: string;
  readonly heading: string;
  readonly tokenEstimate: number;
};

const LARGE_FILE_THRESHOLD = 4096;  // tokens
const TARGET_CHUNK_SIZE = 2048;     // tokens

// ── Semantic Chunking ──────────────────────────────────────────────────
// pattern: Functional Core — pure string chunking with heading context

function chunkText(text: string): Array<Chunk> {
  const totalTokens = estimateTokens(text);

  // If file is small, return as single chunk
  if (totalTokens <= LARGE_FILE_THRESHOLD) {
    return [{
      index: 0,
      content: text,
      heading: '',
      tokenEstimate: totalTokens,
    }];
  }

  // Phase 1: Split on markdown headers (h1-h6)
  // Track heading stack by level to maintain context
  const headerRegex = /^(#{1,6}) (.+)$/m;
  const headingStack: Array<string> = [];
  let currentHeading = '';

  const lines = text.split('\n');
  const sections: Array<{ heading: string; lines: Array<string> }> = [];
  let currentSection: Array<string> = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6}) /);
    if (headerMatch) {
      // New header found
      const level = headerMatch[1].length;

      // Save current section if it has content
      if (currentSection.length > 0) {
        sections.push({ heading: currentHeading, lines: currentSection });
        currentSection = [];
      }

      // Update heading stack: clear deeper levels, update current level
      headingStack.length = level - 1;
      headingStack.push(line);
      currentHeading = line;
    } else {
      currentSection.push(line);
    }
  }

  // Push final section
  if (currentSection.length > 0) {
    sections.push({ heading: currentHeading, lines: currentSection });
  }

  // Phase 2-4: For each section, split if needed on paragraphs, then sentences
  const chunks: Array<Chunk> = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionContent = section.heading
      ? section.heading + '\n' + section.lines.join('\n')
      : section.lines.join('\n');

    const sectionTokens = estimateTokens(sectionContent);

    // If section is small enough, add as single chunk
    if (sectionTokens <= TARGET_CHUNK_SIZE) {
      if (sectionContent.trim()) {
        chunks.push({
          index: chunkIndex++,
          content: sectionContent,
          heading: section.heading,
          tokenEstimate: sectionTokens,
        });
      }
      continue;
    }

    // Section is too large, split on paragraphs (double newlines)
    const paragraphs = sectionContent.split(/\n\n+/);
    let accumulator = '';
    let accumulatorTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      // Check if adding this paragraph exceeds target
      if (accumulatorTokens + paraTokens > TARGET_CHUNK_SIZE && accumulator.trim()) {
        // Flush accumulator
        chunks.push({
          index: chunkIndex++,
          content: accumulator.trim(),
          heading: section.heading,
          tokenEstimate: estimateTokens(accumulator),
        });
        accumulator = para;
        accumulatorTokens = paraTokens;
      } else if (paraTokens > TARGET_CHUNK_SIZE) {
        // Single paragraph exceeds target, split on sentences
        if (accumulator.trim()) {
          chunks.push({
            index: chunkIndex++,
            content: accumulator.trim(),
            heading: section.heading,
            tokenEstimate: estimateTokens(accumulator),
          });
          accumulator = '';
          accumulatorTokens = 0;
        }

        // Split paragraph into sentences
        const sentences = splitBySentences(para);
        let sentenceAccum = '';
        let sentenceAccumTokens = 0;

        for (const sent of sentences) {
          const sentTokens = estimateTokens(sent);

          if (sentenceAccumTokens + sentTokens > TARGET_CHUNK_SIZE && sentenceAccum.trim()) {
            // Flush sentence accumulator
            chunks.push({
              index: chunkIndex++,
              content: sentenceAccum.trim(),
              heading: section.heading,
              tokenEstimate: estimateTokens(sentenceAccum),
            });
            sentenceAccum = sent;
            sentenceAccumTokens = sentTokens;
          } else if (sentTokens > TARGET_CHUNK_SIZE * 1.5) {
            // Sentence itself exceeds hard limit, hard-cut it
            if (sentenceAccum.trim()) {
              chunks.push({
                index: chunkIndex++,
                content: sentenceAccum.trim(),
                heading: section.heading,
                tokenEstimate: estimateTokens(sentenceAccum),
              });
            }
            chunks.push({
              index: chunkIndex++,
              content: sent,
              heading: section.heading,
              tokenEstimate: sentTokens,
            });
            sentenceAccum = '';
            sentenceAccumTokens = 0;
          } else {
            sentenceAccum += (sentenceAccum ? ' ' : '') + sent;
            sentenceAccumTokens += sentTokens + (sentenceAccum ? 1 : 0);
          }
        }

        if (sentenceAccum.trim()) {
          chunks.push({
            index: chunkIndex++,
            content: sentenceAccum.trim(),
            heading: section.heading,
            tokenEstimate: estimateTokens(sentenceAccum),
          });
        }
      } else {
        // Paragraph fits, accumulate it
        accumulator += (accumulator ? '\n\n' : '') + para;
        accumulatorTokens += paraTokens + (accumulator ? 2 : 0); // +2 for \n\n
      }
    }

    if (accumulator.trim()) {
      chunks.push({
        index: chunkIndex++,
        content: accumulator.trim(),
        heading: section.heading,
        tokenEstimate: estimateTokens(accumulator),
      });
    }
  }

  // Filter out empty chunks and renumber
  const finalChunks = chunks.filter((c) => c.content.trim());
  return finalChunks.map((c, idx) => ({ ...c, index: idx }));
}

function splitBySentences(text: string): Array<string> {
  // Split on sentence boundaries: ". " followed by uppercase or ".\n"
  // Fallback: split on single period if no sentence breaks found
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\n/;
  const sentences = text.split(sentenceRegex);

  // If no sentences split, just return the whole text as one unit
  if (sentences.length === 1) {
    return [text];
  }

  // Rejoin with appropriate delimiters and filter empties
  return sentences.filter((s) => s.trim()).map((s) => s.trim());
}

function deriveRkeyFromFilename(filepath: string): string {
  // Extract basename, strip extension, replace spaces with hyphens, lowercase
  const basename = filepath.split('/').pop() ?? 'unknown';
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
  return `knowledge:${nameWithoutExt.replace(/\s+/g, '-').toLowerCase()}`;
}

export function registerIngestTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  const workingDir = deps.workingDir || process.cwd();

  registry.register(
    'ingest_file',
    {
      name: 'ingest_file',
      description: `Read a file from the workspace and process it by intent.

When the user references a file with @/path/to/file, call this tool to ingest it.

Intents:
- memory: Extract facts and append to your self document
- knowledge: Store as a searchable knowledge document
- context: Return content for this conversation only (nothing persisted)`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path (e.g. "notes.md" or "sub/dir/file.md")',
          },
          intent: {
            type: 'string',
            enum: ['memory', 'knowledge', 'context'],
            description: 'How to process the file content',
          },
        },
        required: ['path', 'intent'],
      },
    },
    async (params) => {
      const rawPath = str(params, 'path');
      const intent = str(params, 'intent') as 'memory' | 'knowledge' | 'context';

      // Normalize path: strip leading @/
      let userPath = rawPath.startsWith('@/') ? rawPath.slice(2) : rawPath;

      // Resolve path against workingDir
      // Note: if userPath is absolute (e.g. /etc/passwd), resolve() will ignore workingDir
      const resolvedPath = resolve(workingDir, userPath);
      const canonicalWorkingDir = resolve(workingDir);

      // Security check: ensure resolved path is within workingDir
      // This catches both traversal (../../etc/passwd) and absolute paths (/etc/passwd)
      const canonicalPrefix = canonicalWorkingDir.endsWith('/')
        ? canonicalWorkingDir
        : canonicalWorkingDir + '/';
      if (resolvedPath !== canonicalWorkingDir && !resolvedPath.startsWith(canonicalPrefix)) {
        throw new Error(
          `path traversal detected: ${resolvedPath} is outside workingDir ${canonicalWorkingDir}`,
        );
      }

      // Read file content
      const file = Bun.file(resolvedPath);
      const content = await file.text();

      // Estimate tokens
      const tokenEstimate = estimateTokens(content);

      // For now (Phase 1), reject large files
      if (tokenEstimate > 4096) {
        return JSON.stringify({
          error: 'file too large for Phase 1 (max 4096 tokens)',
          tokenEstimate,
          chunks: 0,
        });
      }

      // Dispatch by intent
      if (intent === 'context') {
        return JSON.stringify({
          content,
          tokenEstimate,
          chunks: 0,
        });
      }

      if (intent === 'memory') {
        const filename = rawPath.split('/').pop() ?? 'unknown';
        const currentSelf = deps.store.docGet('self')?.content ?? '';
        const separator = `\n\n<!-- from: ${filename} -->\n`;
        const updated = currentSelf + separator + content;

        deps.store.docUpsert('self', updated);

        // Fire embedding hook
        if (deps.embedding) {
          try {
            const emb = await deps.embedding.embed(updated);
            deps.store.saveEmbedding('self', emb, 'nomic-embed-text');
          } catch { /* non-fatal */ }
        }

        // Fire recall encoding hook
        if (deps.recallClient) {
          deps.recallClient.encode('self', updated).catch(() => {
            // Silently ignore — Recall encoding is best-effort
          });
        }

        return JSON.stringify({
          content: `Appended to self document`,
          tokenEstimate,
          chunks: 0,
        });
      }

      if (intent === 'knowledge') {
        const rkey = deriveRkeyFromFilename(rawPath);

        deps.store.docUpsert(rkey, content);

        // Fire embedding hook
        if (deps.embedding) {
          try {
            const emb = await deps.embedding.embed(content);
            deps.store.saveEmbedding(rkey, emb, 'nomic-embed-text');
          } catch { /* non-fatal */ }
        }

        // Fire recall encoding hook
        if (deps.recallClient) {
          deps.recallClient.encode(rkey, content).catch(() => {
            // Silently ignore — Recall encoding is best-effort
          });
        }

        return JSON.stringify({
          content: `Stored as ${rkey}`,
          rkey,
          tokenEstimate,
          chunks: 0,
        });
      }

      throw new Error(`unknown intent: ${intent}`);
    },
    'native',
  );
}
