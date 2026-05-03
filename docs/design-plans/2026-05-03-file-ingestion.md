# File Ingestion via @path References

## Summary

`ingest_file` is a new sandbox-mode tool that teaches Johnson how to read files from a configured workspace directory and do something useful with them — store them as memory, index them as searchable knowledge, or just return their content for the current conversation. The agent learns the `@/path` convention purely through its system prompt documentation; there's no interface-layer preprocessing. When a user writes `@/notes.md`, the model recognises the pattern and calls the tool itself.

For small files the flow is straightforward: read, dispatch by intent, done. Large files (over ~4k tokens) go through a chunking pipeline that splits on semantic boundaries (markdown headers, paragraphs, sentences as fallback), summarises each chunk via the existing sub-agent interface, and produces a roll-up summary. That summary is what gets stored or returned — raw chunks are kept alongside it for the `knowledge` intent so they remain retrievable later. The entire feature slots into existing tool registration, document storage, embedding, and sub-agent patterns without introducing new conventions.

## Definition of Done

- Johnson recognises `@/path/to/file` references in user messages and resolves them via the `ingest_file` tool
- The tool reads files relative to the configured `workingDir` with path-traversal protection
- Three intents are supported: `memory` (appends identity facts to `self`), `knowledge` (stores summary + chunks as `knowledge:*` documents), `context` (returns content ephemerally)
- Files exceeding ~4k tokens are automatically chunked and summarised via the sub-agent
- Knowledge documents are retrievable through existing `doc_get` and `doc_search` tools
- Re-ingesting the same file updates existing documents and cleans up stale chunks
- Works identically across TUI and Discord interfaces (agent-layer logic, no interface-specific code)

## Acceptance Criteria

### file-ingestion.AC1: Path resolution and security
- **file-ingestion.AC1.1 Success:** @/notes.md resolves to workingDir/notes.md and reads content
- **file-ingestion.AC1.2 Success:** Nested paths (@/sub/dir/file.md) resolve correctly
- **file-ingestion.AC1.3 Failure:** Path traversal (../../etc/passwd) is rejected with error
- **file-ingestion.AC1.4 Failure:** Absolute paths outside workingDir are rejected
- **file-ingestion.AC1.5 Failure:** Non-existent file returns error with directory listing hint
- **file-ingestion.AC1.6 Failure:** Binary file detected and rejected
- **file-ingestion.AC1.7 Failure:** File exceeding ~400KB rejected with size info

### file-ingestion.AC2: Intent routing — memory
- **file-ingestion.AC2.1 Success:** Small file with memory intent appends facts to self document
- **file-ingestion.AC2.2 Success:** Large file with memory intent extracts identity facts from summary and appends to self
- **file-ingestion.AC2.3 Success:** Memory additions have `<!-- from: filename -->` separator for traceability

### file-ingestion.AC3: Intent routing — knowledge
- **file-ingestion.AC3.1 Success:** Small file stored as `knowledge:<name>` document
- **file-ingestion.AC3.2 Success:** Large file stored as `knowledge:<name>` (summary) + `knowledge:<name>:chunk:<n>` documents
- **file-ingestion.AC3.3 Success:** Summary includes metadata (source path, chunk count, ingest date)
- **file-ingestion.AC3.4 Success:** Re-ingesting same file overwrites existing documents
- **file-ingestion.AC3.5 Success:** Re-ingest with fewer chunks deletes stale chunk documents
- **file-ingestion.AC3.6 Success:** Knowledge documents retrievable via doc_search and doc_get

### file-ingestion.AC4: Intent routing — context
- **file-ingestion.AC4.1 Success:** Small file content returned as tool result, nothing persisted
- **file-ingestion.AC4.2 Success:** Large file returns roll-up summary as tool result, nothing persisted

### file-ingestion.AC5: Chunking and summarisation
- **file-ingestion.AC5.1 Success:** Files over ~4k tokens are chunked into ~2k-token segments
- **file-ingestion.AC5.2 Success:** Chunks split on markdown headers, then paragraph breaks, then sentences
- **file-ingestion.AC5.3 Success:** Parent heading context prepended to each chunk
- **file-ingestion.AC5.4 Success:** Sub-agent produces per-chunk summaries and roll-up
- **file-ingestion.AC5.5 Failure:** Sub-agent failure falls back to naive truncation with warning

### file-ingestion.AC6: Cross-cutting
- **file-ingestion.AC6.1:** Tool works identically when called from TUI or Discord sessions
- **file-ingestion.AC6.2:** Embedding hooks fire for persisted documents (knowledge and memory intents)
- **file-ingestion.AC6.3:** Tool result includes tokenEstimate and chunk count for agent awareness

## Glossary

- **`ingest_file`**: The new tool specified in this document. Takes a workspace-relative path and an intent, handles reading, chunking, summarisation, and storage.
- **`@/path` convention**: Reference syntax (e.g. `@/notes.md`) in user messages signalling a file to ingest. Recognised by the model via system prompt documentation, not code parsing.
- **intent**: Routing parameter (`memory`, `knowledge`, `context`) controlling what happens with file content after reading.
- **`self` document**: Agent identity document (rkey: `self`), auto-loaded into system prompt every turn. The `memory` intent appends facts here.
- **`knowledge:*` documents**: Persistent entries prefixed `knowledge:`. Not auto-loaded; retrieved on demand via `doc_get`/`doc_search`.
- **rkey**: Record key — unique string identifier for a document in the store. Prefix conventions provide namespace structure.
- **SubAgentLLM**: Lightweight single-shot LLM interface for utility tasks (chunk summarisation, roll-up) outside the main agent's tool loop.
- **sandbox mode**: Tool execution inside a Deno subprocess with scoped filesystem access. `ingest_file` uses this to read workspace files.
- **`workingDir`**: Configured workspace root directory. All `@/path` references resolve relative to this; traversal outside is rejected.
- **chunking**: Splitting a large file into ~2k-token segments for summarisation. Split points prefer markdown headers → paragraph breaks → sentence boundaries.
- **roll-up summary**: Single summary produced from all per-chunk summaries, representing the whole file.
- **token estimate**: Character-based heuristic (~4 chars/token) for sizing files without calling the model.
- **FTS5**: SQLite full-text search extension used by `doc_search`. Knowledge documents become FTS-searchable after ingestion.
- **path traversal**: Attack pattern where paths like `../../etc/passwd` escape the intended directory. Explicitly rejected by this design.

## Architecture

Single new sandbox-mode tool (`ingest_file`) registered in the tool system. The agent learns the `@/path` convention through its tool documentation in the system prompt. No preprocessing or interface-layer changes needed — the model recognises the pattern and calls the tool itself.

**Data flow:**

```
User message with @/path → Agent sees raw text → Model calls ingest_file(path, intent)
  → Resolve path against workingDir
  → Read file, estimate tokens
  → If small: return content, store per intent
  → If large: chunk → sub-agent summarise each → roll-up summary → store per intent
  → Return summary/content to agent for continued reasoning
```

**Storage layout by intent:**

| Intent | Storage | Auto-loaded? |
|--------|---------|--------------|
| `memory` | Facts appended to `self` document | Yes (every turn) |
| `knowledge` | `knowledge:<name>` (summary) + `knowledge:<name>:chunk:<n>` (raw chunks) | No (on-demand via doc_get/doc_search) |
| `context` | Nothing persisted | N/A |

**Contract — tool parameters:**

```typescript
interface IngestFileParams {
  readonly path: string;
  readonly intent: 'memory' | 'knowledge' | 'context';
}

interface IngestFileResult {
  readonly content: string;       // summary or full content
  readonly rkey?: string;         // where it was stored (if persisted)
  readonly chunks?: number;       // chunk count (if chunked)
  readonly tokenEstimate: number; // size of the original file
}
```

## Existing Patterns

Investigation found the following patterns this design follows:

- **Tool registration:** `src/tools/` modules export `register*Tools()` functions called from `createAgentTools()` in `src/agent/tools.ts`. New tool follows this pattern as `src/tools/ingest.ts` → `registerIngestTools()`.
- **Sandbox mode:** Most tools use sandbox mode (Deno executor with `workingDir` access). `ingest_file` follows suit — it needs filesystem access scoped to workspace.
- **Sub-agent usage:** `SubAgentLLM` is already used for compaction summaries (`src/agent/compaction.ts`). Chunked summarisation reuses the same sub-agent interface.
- **Document storage:** `doc_upsert` with rkey prefixes is the established pattern. `knowledge:*` follows the same convention as `skill:*`, `archive:*`, `task:*`.
- **Embedding hooks:** `doc_upsert` already fires embedding and Recall encoding hooks asynchronously. Knowledge documents get this for free.
- **Path resolution:** `config.runtime.workingDir` is already resolved to an absolute path at startup (in `src/config/loader.ts`). The tool resolves user paths against this.

No divergence from existing patterns. This design slots into the established architecture without introducing new conventions.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Core Tool Registration and Small File Handling

**Goal:** `ingest_file` tool exists, resolves paths safely, reads small files, and stores per intent.

**Components:**
- `src/tools/ingest.ts` — tool module with `registerIngestTools()`, path resolution, size detection, intent dispatch
- `src/agent/tools.ts` — wire `registerIngestTools()` into `createAgentTools()`
- Path security: canonicalise and reject traversal outside `workingDir`
- Storage dispatch: `memory` appends to `self` with separator, `knowledge` stores as `knowledge:<name>`, `context` returns content only

**Dependencies:** None (first phase)

**Done when:** `ingest_file` can read a small file from workspace, store it per each intent, and reject path traversal attempts. Tests verify all three intents and the security boundary.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Chunking Pipeline

**Goal:** Large files are split into semantic chunks with header context preserved.

**Components:**
- Chunking logic in `src/tools/ingest.ts` (or extracted to `src/tools/ingest/chunker.ts` if complex) — splits on markdown headers, double newlines, sentence boundaries as fallback
- Token estimation utility (character-based heuristic, ~4 chars per token)
- Chunk metadata: index, parent heading, token estimate per chunk

**Dependencies:** Phase 1 (tool exists and can read files)

**Done when:** A file over 4k tokens is split into ~2k-token chunks with correct heading context. Tests verify splitting at markdown boundaries, fallback to sentence splitting, and header propagation.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Sub-Agent Summarisation

**Goal:** Chunks are summarised via `SubAgentLLM`, producing per-chunk summaries and a roll-up.

**Components:**
- Summarisation orchestrator in `src/tools/ingest.ts` — iterates chunks, calls sub-agent per chunk, produces roll-up from chunk summaries
- Prompt templates for chunk summarisation and roll-up (with intent-aware prompting for `memory` vs `knowledge`)
- Integration with existing `SubAgentLLM` from `src/model/sub-agent.ts`

**Dependencies:** Phase 2 (chunking produces chunks to summarise)

**Done when:** A large file produces a coherent roll-up summary and per-chunk summaries. `memory` intent extracts identity facts. `knowledge` intent produces reference summaries. Tests verify summarisation output structure and intent-specific prompting.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Knowledge Storage and Retrieval

**Goal:** Large-file knowledge storage with summary + chunks layout, including update/cleanup semantics.

**Components:**
- Storage logic for `knowledge:<name>` (summary with metadata: source path, chunk count, ingest date) and `knowledge:<name>:chunk:<n>` documents
- Update semantics: re-ingest overwrites summary, replaces chunks, deletes stale chunks beyond new count
- `memory` intent for large files: extract identity facts from roll-up, append to `self` with `<!-- from: filename -->` marker

**Dependencies:** Phase 3 (summarisation produces content to store)

**Done when:** Large file ingested as knowledge produces correct document layout. Re-ingesting a file with fewer chunks cleans up old chunks. Memory intent appends traceable facts to `self`. Tests verify storage layout, update cleanup, and self-document modification.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Error Handling and Edge Cases

**Goal:** Graceful handling of missing files, binary files, oversized files, and summarisation failures.

**Components:**
- Error detection in `src/tools/ingest.ts`: file-not-found (with directory listing hint), binary detection (null byte scan), size cap (~400KB / ~100k tokens)
- Fallback: if sub-agent summarisation fails, truncate to first 4k tokens with warning
- User-facing error messages returned as tool results

**Dependencies:** Phase 4 (full pipeline must exist to add error handling around it)

**Done when:** Each error case returns a clear, actionable message. Summarisation failure falls back gracefully. Tests verify all error scenarios from the design table.
<!-- END_PHASE_5 -->

## Additional Considerations

**System prompt documentation:** The tool's description in the prompt must teach Johnson the `@/path` convention clearly. This is the sole mechanism for recognition — no regex parsing elsewhere. If the model fails to recognise a reference, the fix is prompt tuning, not code.

**Token budget awareness:** Storing large summaries as tool results still consumes context. The roll-up summary for `context` intent should be concise (~500 tokens max) to leave room for conversation.

**Future extensibility:** The `knowledge:*` prefix and chunk layout could support a dedicated `search_knowledge` tool later that searches only knowledge documents. Not in scope now — `doc_search` covers it.
