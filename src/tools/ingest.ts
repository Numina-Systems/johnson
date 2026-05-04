// pattern: Imperative Shell — ingest_file tool handler with file I/O and path resolution

import { resolve } from 'node:path';
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { estimateTokens } from '../agent/context.ts';
import { chunkText, type Chunk, LARGE_FILE_THRESHOLD } from './chunking.ts';

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
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
