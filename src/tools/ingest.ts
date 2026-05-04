// pattern: Imperative Shell — ingest_file tool handler with file I/O and path resolution

import { resolve, dirname } from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import { estimateTokens } from '../agent/context.ts';
import { chunkText, type Chunk, LARGE_FILE_THRESHOLD } from './chunking.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';

const MAX_FILE_SIZE_BYTES = 400_000; // ~400KB

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

// ── Task 1: Summarisation orchestrator ────────────────────────────────

type SummarizationResult = {
  readonly perChunk: ReadonlyArray<string>;
  readonly rollUp: string;
};

async function summarizeChunks(
  chunks: ReadonlyArray<Chunk>,
  intent: 'memory' | 'knowledge' | 'context',
  subAgent: SubAgentLLM,
): Promise<SummarizationResult> {
  const systemPrompts: Record<string, string> = {
    memory:
      'You are extracting identity facts about a person or agent from a document chunk. Output only factual statements about who they are, what they do, their preferences, and their relationships. Be concise — bullet points.',
    knowledge:
      'You are summarizing a document chunk for future reference. Capture the key information, decisions, and details that would be useful when searching for this content later. Be concise but complete.',
    context:
      'You are summarizing a document chunk to give the reader a quick understanding of its content. Focus on the main points and any actionable information.',
  };

  const chunkSystemPrompt = systemPrompts[intent] ?? systemPrompts.context;

  const CONCURRENCY = 4;
  const MAX_RETRIES = 2;
  const perChunkSummaries: string[] = new Array(chunks.length);

  for (let start = 0; start < chunks.length; start += CONCURRENCY) {
    const batch = chunks.slice(start, start + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((chunk) => subAgent.complete(chunk.content, chunkSystemPrompt)),
    );

    const retryIndices: number[] = [];
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        perChunkSummaries[start + j] = r.value;
      } else {
        retryIndices.push(j);
      }
    }

    for (const j of retryIndices) {
      let succeeded = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          perChunkSummaries[start + j] = await subAgent.complete(batch[j].content, chunkSystemPrompt);
          succeeded = true;
          break;
        } catch { /* retry */ }
      }
      if (!succeeded) {
        perChunkSummaries[start + j] = `[summarisation failed for chunk ${start + j}]`;
      }
    }
  }

  const combinedSummaries = perChunkSummaries.join('\n\n');

  const rollUpSystemPrompt =
    'You are creating a single concise summary from multiple chunk summaries of the same document. Synthesize the key points into 2-5 sentences that capture the document\'s essential content. Do not use bullet points or headers.';

  const rollUp = await subAgent.complete(combinedSummaries, rollUpSystemPrompt);

  return { perChunk: perChunkSummaries, rollUp };
}

function deriveRkeyFromFilename(filepath: string): string {
  // Extract basename, strip extension, replace spaces with hyphens, lowercase
  const basename = filepath.split('/').pop() ?? 'unknown';
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
  return `knowledge:${nameWithoutExt.replace(/\s+/g, '-').toLowerCase()}`;
}

function cleanupStaleChunks(
  store: Store,
  baseRkey: string,
  newChunkCount: number,
): void {
  let i = newChunkCount;
  while (true) {
    const chunkRkey = `${baseRkey}:chunk:${i}`;
    const exists = store.docGet(chunkRkey);
    if (!exists) break;
    store.docDelete(chunkRkey);
    i++;
  }
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

      // File existence check with directory listing hint
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(resolvedPath);
        if (!fileStat.isFile()) {
          return JSON.stringify({
            error: `Path is a directory, not a file: ${userPath}`,
            tokenEstimate: 0,
          });
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // List files in parent directory as hint
          const dir = dirname(resolvedPath);
          let hint = '';
          try {
            const entries = await readdir(dir);
            const textFiles = entries.filter(e => !e.startsWith('.')).slice(0, 10);
            if (textFiles.length > 0) {
              hint = `\nFiles in ${dirname(userPath) || '.'}:\n${textFiles.map(f => `  ${f}`).join('\n')}`;
            }
          } catch { /* directory might not exist either */ }

          return JSON.stringify({
            error: `File not found: ${userPath}${hint}`,
            tokenEstimate: 0,
          });
        }
        throw err;
      }

      // Size limit check (before reading content)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        const sizeKb = Math.round(fileStat.size / 1024);
        return JSON.stringify({
          error: `File too large: ${userPath} (${sizeKb}KB). Maximum is ~400KB.`,
          tokenEstimate: Math.ceil(fileStat.size / 4),
        });
      }

      // Read file content
      const file = Bun.file(resolvedPath);
      const content = await file.text();

      // Binary detection (check for null bytes in first 8KB)
      const sample = content.slice(0, 8192);
      if (sample.includes('\0')) {
        return JSON.stringify({
          error: `Binary file detected: ${userPath}. Only text files are supported.`,
          tokenEstimate: 0,
        });
      }

      // Estimate tokens
      const tokenEstimate = estimateTokens(content);

      // Handle large files via chunking path
      if (tokenEstimate > LARGE_FILE_THRESHOLD) {
        const chunks = chunkText(content);

        if (!deps.subAgent) {
          // No sub-agent configured — fall back to truncation
          const truncated = content.slice(0, LARGE_FILE_THRESHOLD * 4);
          return JSON.stringify({
            content: `[truncated — sub-agent not configured] ${truncated}`,
            tokenEstimate,
            chunks: chunks.length,
          });
        }

        let rollUp: string;
        try {
          const { rollUp: summary } = await summarizeChunks(chunks, intent, deps.subAgent);
          rollUp = summary;
        } catch {
          // Fallback: truncate to first ~4k tokens with warning
          const truncated = content.slice(0, LARGE_FILE_THRESHOLD * 4);
          rollUp = `[summarisation failed — showing first ~${LARGE_FILE_THRESHOLD} tokens]\n\n${truncated}`;
        }

        // Dispatch by intent for large files
        if (intent === 'context') {
          return JSON.stringify({
            content: rollUp,
            tokenEstimate,
            chunks: chunks.length,
          });
        }

        if (intent === 'memory') {
          const filename = rawPath.split('/').pop() ?? 'unknown';
          const currentSelf = deps.store.docGet('self')?.content ?? '';
          const separator = `\n\n<!-- from: ${filename} -->\n`;
          const updated = currentSelf + separator + rollUp;

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
            chunks: chunks.length,
          });
        }

        if (intent === 'knowledge') {
          const rkey = deriveRkeyFromFilename(rawPath);

          // Clean up any stale chunks from previous ingest
          cleanupStaleChunks(deps.store, rkey, chunks.length);

          // Build summary document with metadata header
          const summaryContent = `<!-- source: ${rawPath} -->
<!-- chunks: ${chunks.length} -->
<!-- ingested: ${new Date().toISOString()} -->

${rollUp}`;

          // Store summary document
          deps.store.docUpsert(rkey, summaryContent);

          // Store each chunk document
          for (let i = 0; i < chunks.length; i++) {
            const chunkRkey = `${rkey}:chunk:${i}`;
            deps.store.docUpsert(chunkRkey, chunks[i]!.content);
          }

          // Fire embedding hook for summary
          if (deps.embedding) {
            try {
              const emb = await deps.embedding.embed(summaryContent);
              deps.store.saveEmbedding(rkey, emb, 'nomic-embed-text');
            } catch { /* non-fatal */ }
          }

          // Fire embedding hooks for chunks
          if (deps.embedding) {
            for (let i = 0; i < chunks.length; i++) {
              try {
                const emb = await deps.embedding.embed(chunks[i]!.content);
                deps.store.saveEmbedding(`${rkey}:chunk:${i}`, emb, 'nomic-embed-text');
              } catch { /* non-fatal */ }
            }
          }

          // Fire recall encoding hook for summary
          if (deps.recallClient) {
            deps.recallClient.encode(rkey, summaryContent).catch(() => {
              // Silently ignore — Recall encoding is best-effort
            });
          }

          // Fire recall encoding hooks for chunks
          if (deps.recallClient) {
            for (let i = 0; i < chunks.length; i++) {
              deps.recallClient
                .encode(`${rkey}:chunk:${i}`, chunks[i]!.content)
                .catch(() => {
                  // Silently ignore — Recall encoding is best-effort
                });
            }
          }

          return JSON.stringify({
            content: `Stored as ${rkey}`,
            rkey,
            tokenEstimate,
            chunks: chunks.length,
          });
        }
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

        // Clean up any chunks from a previously-large file
        cleanupStaleChunks(deps.store, rkey, 0);

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
