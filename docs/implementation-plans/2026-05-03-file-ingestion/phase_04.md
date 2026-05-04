# File Ingestion Implementation Plan — Phase 4

**Goal:** Large-file knowledge storage with summary + chunk document layout, including update/cleanup semantics for re-ingestion.

**Architecture:** Extends the knowledge intent handler in `src/tools/ingest.ts` to store both a summary document (`knowledge:<name>`) with metadata and individual chunk documents (`knowledge:<name>:chunk:<n>`). Re-ingestion overwrites existing documents and deletes stale chunks by iterating beyond the new chunk count until `docGet` returns null.

**Tech Stack:** Existing `Store` interface (`docUpsert`, `docGet`, `docDelete`). No new dependencies.

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-05-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### file-ingestion.AC3: Intent routing — knowledge
- **file-ingestion.AC3.2 Success:** Large file stored as `knowledge:<name>` (summary) + `knowledge:<name>:chunk:<n>` documents
- **file-ingestion.AC3.3 Success:** Summary includes metadata (source path, chunk count, ingest date)
- **file-ingestion.AC3.4 Success:** Re-ingesting same file overwrites existing documents
- **file-ingestion.AC3.5 Success:** Re-ingest with fewer chunks deletes stale chunk documents
- **file-ingestion.AC3.6 Success:** Knowledge documents retrievable via doc_search and doc_get

### file-ingestion.AC6: Cross-cutting
- **file-ingestion.AC6.2:** Embedding hooks fire for persisted documents (knowledge and memory intents)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Knowledge storage with summary + chunks for large files

**Verifies:** file-ingestion.AC3.2, file-ingestion.AC3.3, file-ingestion.AC6.2

**Files:**
- Modify: `src/tools/ingest.ts` (extend large-file knowledge handler)

**Implementation:**

Replace the placeholder knowledge handling for large files with proper storage:

After summarisation produces `perChunk` summaries and `rollUp`:

1. Derive base rkey: `knowledge:${deriveKnowledgeName(filename)}`
   - `deriveKnowledgeName`: strip extension, replace spaces/special chars with hyphens, lowercase
   - e.g., `My Notes.md` → `knowledge:my-notes`

2. Build summary document content with metadata header:
   ```
   <!-- source: ${path} -->
   <!-- chunks: ${chunks.length} -->
   <!-- ingested: ${new Date().toISOString()} -->

   ${rollUp}
   ```

3. Store summary: `deps.store.docUpsert(baseRkey, summaryContent)`

4. Store each chunk:
   ```typescript
   for (let i = 0; i < chunks.length; i++) {
     const chunkRkey = `${baseRkey}:chunk:${i}`;
     deps.store.docUpsert(chunkRkey, chunks[i].content);
   }
   ```

5. Fire embedding for summary document:
   ```typescript
   if (deps.embedding) {
     try {
       const emb = await deps.embedding.embed(summaryContent);
       deps.store.saveEmbedding(baseRkey, emb, 'nomic-embed-text');
     } catch { /* non-fatal */ }
   }
   ```

6. Fire embedding for each chunk (enables semantic search over chunks):
   ```typescript
   if (deps.embedding) {
     for (let i = 0; i < chunks.length; i++) {
       try {
         const emb = await deps.embedding.embed(chunks[i].content);
         deps.store.saveEmbedding(`${baseRkey}:chunk:${i}`, emb, 'nomic-embed-text');
       } catch { /* non-fatal */ }
     }
   }
   ```

7. Fire recall encoding for summary and chunks:
   ```typescript
   if (deps.recallClient) {
     deps.recallClient.encode(baseRkey, summaryContent).catch(() => {});
     for (let i = 0; i < chunks.length; i++) {
       deps.recallClient.encode(`${baseRkey}:chunk:${i}`, chunks[i].content).catch(() => {});
     }
   }
   ```

8. Return result with rkey and chunk count.

**Note on embedding model name:** Use whatever model string the embedding provider is configured with. The hardcoded `'nomic-embed-text'` follows the pattern in `doc_upsert` (`src/agent/tools.ts:94`) — if this changes in the codebase, update here too.

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: Knowledge storage tests pass

**Commit:** `feat(ingest): store large-file knowledge as summary + chunk documents`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Re-ingestion cleanup — delete stale chunks

**Verifies:** file-ingestion.AC3.4, file-ingestion.AC3.5

**Files:**
- Modify: `src/tools/ingest.ts` (add cleanup before storage)

**Implementation:**

Before storing new chunks, clean up any existing chunks that exceed the new count:

```typescript
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
```

Call this after determining the new chunk count but before (or after) writing new chunks. The order doesn't matter since we overwrite existing chunks by rkey.

Place the cleanup call in the knowledge handler for large files:
```typescript
cleanupStaleChunks(deps.store, baseRkey, chunks.length);
```

For small files with knowledge intent (from Phase 1), also clean up any existing chunks (in case a previously-large file is now small after editing):
```typescript
cleanupStaleChunks(deps.store, baseRkey, 0);
```

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: Re-ingestion cleanup tests pass

**Commit:** `feat(ingest): clean up stale chunk documents on re-ingestion`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Knowledge storage and re-ingestion tests

**Verifies:** file-ingestion.AC3.2, file-ingestion.AC3.3, file-ingestion.AC3.4, file-ingestion.AC3.5, file-ingestion.AC3.6

**Files:**
- Modify: `src/tools/ingest.test.ts` (add knowledge storage test describe block)

**Testing:**

Use in-memory store. Mock sub-agent for summarisation. Create large test files programmatically.

Test cases:
- **file-ingestion.AC3.2 — summary + chunks layout:**
  - Ingest large file with `intent: 'knowledge'`
  - Verify `store.docGet('knowledge:test-file')` returns content with roll-up
  - Verify `store.docGet('knowledge:test-file:chunk:0')` through `chunk:N-1` all exist with chunk content

- **file-ingestion.AC3.3 — metadata in summary:**
  - Parse the summary document content
  - Verify `<!-- source: test-file.md -->` present
  - Verify `<!-- chunks: N -->` present
  - Verify `<!-- ingested: ... -->` present with ISO date

- **file-ingestion.AC3.4 — re-ingest overwrites:**
  - Ingest file once, then ingest again with different content
  - Verify summary document contains new roll-up, not old one
  - Verify chunk documents contain new content

- **file-ingestion.AC3.5 — stale chunk cleanup:**
  - Ingest large file producing 5 chunks
  - Modify file to be smaller (produces 3 chunks)
  - Re-ingest
  - Verify chunks 0-2 exist with new content
  - Verify chunks 3-4 no longer exist (`store.docGet` returns null)

- **file-ingestion.AC3.6 — retrievable via search:**
  - Ingest a file with `intent: 'knowledge'`
  - Call `store.docSearch('keyword-from-content')`
  - Verify the knowledge document appears in results

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All knowledge storage tests pass

**Commit:** `test(ingest): add knowledge storage and re-ingestion tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
