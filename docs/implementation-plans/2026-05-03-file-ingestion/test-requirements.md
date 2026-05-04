# Test Requirements — File Ingestion

Maps each acceptance criterion to automated tests or human verification.

All automated tests live in: `src/tools/ingest.test.ts`

---

## AC1: Path resolution and security

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC1.1 | @/notes.md resolves to workingDir/notes.md and reads content | Automated (unit) | `src/tools/ingest.test.ts` | Call with `path: 'notes.md'` and `intent: 'context'`, verify returned content matches file. Uses temp dir as workingDir with fixture file. |
| file-ingestion.AC1.2 | Nested paths (@/sub/dir/file.md) resolve correctly | Automated (unit) | `src/tools/ingest.test.ts` | Call with `path: 'sub/dir/file.md'`, verify content reads from nested fixture file in temp dir. |
| file-ingestion.AC1.3 | Path traversal (../../etc/passwd) is rejected with error | Automated (unit) | `src/tools/ingest.test.ts` | Call with `path: '../../etc/passwd'`, verify JSON result contains error mentioning traversal/security rejection. No file read occurs. |
| file-ingestion.AC1.4 | Absolute paths outside workingDir are rejected | Automated (unit) | `src/tools/ingest.test.ts` | Call with `path: '/etc/passwd'`, verify JSON result contains error. Path does not resolve within workingDir. |
| file-ingestion.AC1.5 | Non-existent file returns error with directory listing hint | Automated (unit) | `src/tools/ingest.test.ts` | Call with `path: 'does-not-exist.md'` in a temp dir containing other files. Verify error mentions "not found" and hint lists sibling files. |
| file-ingestion.AC1.6 | Binary file detected and rejected | Automated (unit) | `src/tools/ingest.test.ts` | Write file with null bytes to temp dir. Call ingest on it. Verify error mentions "binary". No store writes occur. |
| file-ingestion.AC1.7 | File exceeding ~400KB rejected with size info | Automated (unit) | `src/tools/ingest.test.ts` | Write 500KB file to temp dir. Call ingest. Verify error mentions size limit and reports actual file size. |

## AC2: Intent routing — memory

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC2.1 | Small file with memory intent appends facts to self document | Automated (unit) | `src/tools/ingest.test.ts` | Ingest small file with `intent: 'memory'`. Verify `store.docGet('self')` contains the file content appended. |
| file-ingestion.AC2.2 | Large file with memory intent extracts identity facts from summary and appends to self | Automated (integration) | `src/tools/ingest.test.ts` | Ingest large file (>4k tokens) with `intent: 'memory'` using mock SubAgentLLM. Verify `store.docGet('self')` contains summarised content with from-separator. |
| file-ingestion.AC2.3 | Memory additions have `<!-- from: filename -->` separator for traceability | Automated (unit) | `src/tools/ingest.test.ts` | After memory intent ingest, verify stored self document includes `<!-- from: notes.md -->` separator before appended content. |

## AC3: Intent routing — knowledge

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC3.1 | Small file stored as `knowledge:<name>` document | Automated (unit) | `src/tools/ingest.test.ts` | Ingest small file with `intent: 'knowledge'`. Verify `store.docGet('knowledge:notes')` returns the file content. |
| file-ingestion.AC3.2 | Large file stored as `knowledge:<name>` (summary) + `knowledge:<name>:chunk:<n>` documents | Automated (integration) | `src/tools/ingest.test.ts` | Ingest large file with `intent: 'knowledge'` using mock sub-agent. Verify summary doc exists at `knowledge:test-file` and chunk docs exist at `knowledge:test-file:chunk:0` through `chunk:N-1`. |
| file-ingestion.AC3.3 | Summary includes metadata (source path, chunk count, ingest date) | Automated (unit) | `src/tools/ingest.test.ts` | Parse summary document content. Verify `<!-- source: ... -->`, `<!-- chunks: N -->`, and `<!-- ingested: ... -->` comments are present with correct values. |
| file-ingestion.AC3.4 | Re-ingesting same file overwrites existing documents | Automated (integration) | `src/tools/ingest.test.ts` | Ingest file twice with different content. Verify summary and chunk documents contain second version's content, not first. |
| file-ingestion.AC3.5 | Re-ingest with fewer chunks deletes stale chunk documents | Automated (integration) | `src/tools/ingest.test.ts` | Ingest large file producing 5 chunks. Re-ingest shorter version producing 3 chunks. Verify chunks 0-2 exist, chunks 3-4 return null from `store.docGet()`. |
| file-ingestion.AC3.6 | Knowledge documents retrievable via doc_search and doc_get | Automated (integration) | `src/tools/ingest.test.ts` | Ingest file with `intent: 'knowledge'`. Call `store.docSearch()` with a keyword from the content. Verify the knowledge document appears in results. |

## AC4: Intent routing — context

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC4.1 | Small file content returned as tool result, nothing persisted | Automated (unit) | `src/tools/ingest.test.ts` | Ingest small file with `intent: 'context'`. Verify result JSON contains file content. Verify `store.docGet('knowledge:...')` returns null (nothing persisted). |
| file-ingestion.AC4.2 | Large file returns roll-up summary as tool result, nothing persisted | Automated (integration) | `src/tools/ingest.test.ts` | Ingest large file with `intent: 'context'` and mock sub-agent. Verify result contains roll-up summary text. Verify no documents persisted to store. |

## AC5: Chunking and summarisation

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC5.1 | Files over ~4k tokens are chunked into ~2k-token segments | Automated (unit) | `src/tools/ingest.test.ts` | Call exported `chunkText()` with content >4k tokens. Verify multiple chunks returned, each ≤ ~2k tokens (allow 1.5x overshoot for hard-cut edge case). |
| file-ingestion.AC5.2 | Chunks split on markdown headers, then paragraph breaks, then sentences | Automated (unit) | `src/tools/ingest.test.ts` | Three tests: (1) markdown file splits at headers, (2) headerless file splits at `\n\n`, (3) dense text splits at sentence boundaries. Verify split points match expected priority. |
| file-ingestion.AC5.3 | Parent heading context prepended to each chunk | Automated (unit) | `src/tools/ingest.test.ts` | Chunk a markdown file with nested headings. Verify each chunk's `heading` field reflects its parent heading context. First chunk before any heading has empty string. |
| file-ingestion.AC5.4 | Sub-agent produces per-chunk summaries and roll-up | Automated (integration) | `src/tools/ingest.test.ts` | Call `ingest_file` with large file and mock sub-agent. Verify sub-agent `complete()` called N+1 times (once per chunk + one roll-up). Verify result contains the roll-up. |
| file-ingestion.AC5.5 | Sub-agent failure falls back to naive truncation with warning | Automated (integration) | `src/tools/ingest.test.ts` | Mock sub-agent that throws. Call `ingest_file` with large file. Verify result contains truncated content with warning message. No unhandled exception. |

## AC6: Cross-cutting

| AC ID | Description | Type | Test Location | Verification Approach |
|-------|-------------|------|---------------|----------------------|
| file-ingestion.AC6.1 | Tool works identically when called from TUI or Discord sessions | Human verification | N/A | **Justification:** Tool is registered at agent layer via `createAgentTools()` with no interface-specific code paths. Architectural inspection confirms identical behaviour. **Approach:** Code review verifies no TUI/Discord branching in `src/tools/ingest.ts`. Optionally, manual smoke test from both interfaces calling `ingest_file` with same params and comparing results. |
| file-ingestion.AC6.2 | Embedding hooks fire for persisted documents (knowledge and memory intents) | Automated (unit) | `src/tools/ingest.test.ts` | Mock embedding provider. Ingest with memory and knowledge intents. Verify `embed()` is called. Ingest with context intent, verify `embed()` is NOT called. |
| file-ingestion.AC6.3 | Tool result includes tokenEstimate and chunk count for agent awareness | Automated (unit) | `src/tools/ingest.test.ts` | Parse JSON result from any ingest call. Verify `tokenEstimate` is a number > 0. Verify `chunks` field is present (0 for small files, >0 for large files). |
