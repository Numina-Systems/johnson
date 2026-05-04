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

export function chunkText(text: string): Array<Chunk> {
  // Handle empty/whitespace input
  if (!text.trim()) {
    return [];
  }

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
  const lines = text.split('\n');
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = '';
  let currentLines: Array<string> = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6}) /);
    if (headerMatch) {
      // Save previous section if it has content
      const content = currentLines.join('\n');
      if (content.trim()) {
        sections.push({
          heading: currentHeading,
          content: currentHeading ? currentHeading + '\n' + content : content,
        });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save final section
  const content = currentLines.join('\n');
  if (content.trim()) {
    sections.push({
      heading: currentHeading,
      content: currentHeading ? currentHeading + '\n' + content : content,
    });
  }

  // Phase 2-4: For each section, split recursively on paragraphs, then sentences
  const chunks: Array<Chunk> = [];

  for (const section of sections) {
    splitSection(section.content, section.heading, chunks);
  }

  // Filter empty chunks and renumber
  const finalChunks = chunks.filter((c) => c.content.trim());
  return finalChunks.map((c, idx) => ({ ...c, index: idx }));
}

function splitSection(content: string, heading: string, chunks: Array<Chunk>): void {
  const contentTokens = estimateTokens(content);

  // Base case: content fits in target
  if (contentTokens <= TARGET_CHUNK_SIZE) {
    if (content.trim()) {
      chunks.push({
        index: chunks.length,
        content,
        heading,
        tokenEstimate: contentTokens,
      });
    }
    return;
  }

  // Try splitting on paragraphs (double newlines)
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());

  if (paragraphs.length > 1) {
    let accumulator = '';
    let accumulatorTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      if (accumulatorTokens + paraTokens > TARGET_CHUNK_SIZE && accumulator.trim()) {
        // Flush accumulator
        chunks.push({
          index: chunks.length,
          content: accumulator.trim(),
          heading,
          tokenEstimate: estimateTokens(accumulator),
        });
        accumulator = para;
        accumulatorTokens = paraTokens;
      } else if (paraTokens > TARGET_CHUNK_SIZE) {
        // Paragraph exceeds target, split recursively on sentences
        if (accumulator.trim()) {
          chunks.push({
            index: chunks.length,
            content: accumulator.trim(),
            heading,
            tokenEstimate: estimateTokens(accumulator),
          });
          accumulator = '';
          accumulatorTokens = 0;
        }
        splitOnSentences(para, heading, chunks);
      } else {
        // Paragraph fits, accumulate
        accumulator += (accumulator ? '\n\n' : '') + para;
        accumulatorTokens = estimateTokens(accumulator);
      }
    }

    if (accumulator.trim()) {
      chunks.push({
        index: chunks.length,
        content: accumulator.trim(),
        heading,
        tokenEstimate: estimateTokens(accumulator),
      });
    }
  } else {
    // No paragraph breaks, split on sentences
    splitOnSentences(content, heading, chunks);
  }
}

function splitOnSentences(content: string, heading: string, chunks: Array<Chunk>): void {
  const contentTokens = estimateTokens(content);

  if (contentTokens <= TARGET_CHUNK_SIZE) {
    if (content.trim()) {
      chunks.push({
        index: chunks.length,
        content,
        heading,
        tokenEstimate: contentTokens,
      });
    }
    return;
  }

  // Split on sentence boundaries
  const sentences = splitBySentences(content);

  if (sentences.length > 1) {
    let accumulator = '';
    let accumulatorTokens = 0;

    for (const sent of sentences) {
      const sentTokens = estimateTokens(sent);

      if (accumulatorTokens + sentTokens > TARGET_CHUNK_SIZE && accumulator.trim()) {
        // Flush accumulator
        chunks.push({
          index: chunks.length,
          content: accumulator.trim(),
          heading,
          tokenEstimate: estimateTokens(accumulator),
        });
        accumulator = sent;
        accumulatorTokens = sentTokens;
      } else if (sentTokens > TARGET_CHUNK_SIZE * 1.5) {
        // Sentence exceeds hard limit, hard-cut it
        if (accumulator.trim()) {
          chunks.push({
            index: chunks.length,
            content: accumulator.trim(),
            heading,
            tokenEstimate: estimateTokens(accumulator),
          });
        }

        // Hard-cut the overly long sentence into manageable pieces
        hardCutContent(sent, heading, chunks);
        accumulator = '';
        accumulatorTokens = 0;
      } else {
        // Sentence fits, accumulate
        accumulator += (accumulator ? ' ' : '') + sent;
        accumulatorTokens = estimateTokens(accumulator);
      }
    }

    if (accumulator.trim()) {
      chunks.push({
        index: chunks.length,
        content: accumulator.trim(),
        heading,
        tokenEstimate: estimateTokens(accumulator),
      });
    }
  } else {
    // No sentence breaks possible, hard-cut
    hardCutContent(content, heading, chunks);
  }
}

function hardCutContent(content: string, heading: string, chunks: Array<Chunk>): void {
  // Hard-cut strategy: split by character count targeting ~2048 tokens worth of characters
  const targetChars = TARGET_CHUNK_SIZE * 4; // 4 chars per token estimate
  let start = 0;

  while (start < content.length) {
    const end = Math.min(start + targetChars, content.length);
    const piece = content.slice(start, end);

    if (piece.trim()) {
      chunks.push({
        index: chunks.length,
        content: piece.trim(),
        heading,
        tokenEstimate: estimateTokens(piece),
      });
    }

    start = end;
  }
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

      // Handle large files via chunking path
      if (tokenEstimate > LARGE_FILE_THRESHOLD) {
        const chunks = chunkText(content);
        return JSON.stringify({
          content: `File has ${chunks.length} chunks (${tokenEstimate} tokens). Summarisation not yet implemented.`,
          tokenEstimate,
          chunks: chunks.length,
        });
      }

      // Dispatch by intent (small-file path unchanged)
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
