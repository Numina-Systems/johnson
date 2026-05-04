// pattern: Imperative Shell — ingest_file tool handler with file I/O and path resolution

import { resolve } from 'node:path';
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { estimateTokens } from '../agent/context.ts';
import { chunkText, type Chunk, LARGE_FILE_THRESHOLD } from './chunking.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';

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

  const perChunkSummaries: string[] = [];

  // Process chunks sequentially to avoid overwhelming the sub-agent with concurrent requests
  // and to allow early detection of service failures
  for (const chunk of chunks) {
    const summary = await subAgent.complete(chunk.content, chunkSystemPrompt);
    perChunkSummaries.push(summary);
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

          // Store just the roll-up summary (Phase 4 will add chunk documents)
          deps.store.docUpsert(rkey, rollUp);

          // Fire embedding hook
          if (deps.embedding) {
            try {
              const emb = await deps.embedding.embed(rollUp);
              deps.store.saveEmbedding(rkey, emb, 'nomic-embed-text');
            } catch { /* non-fatal */ }
          }

          // Fire recall encoding hook
          if (deps.recallClient) {
            deps.recallClient.encode(rkey, rollUp).catch(() => {
              // Silently ignore — Recall encoding is best-effort
            });
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
