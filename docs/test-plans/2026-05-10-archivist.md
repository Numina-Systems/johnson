# Human Test Plan: Archivist Background Agent

## Prerequisites

- Agent running with `bun start` in a configured environment
- `bun test` passing (263+ archivist tests, 0 failures)
- `config.toml` with `[archivist]` section configured, `[sub_model]` configured, and `[embedding]` configured
- Store populated with at least a few `knowledge:*` documents for observation

## Phase 1: Schedule Timing Verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set `[archivist]` config: `enabled = true`, `daytime_schedule = "0 6-22 * * *"`, `nighttime_schedule = "0 2 * * *"` | Config accepted without error |
| 2 | Start the agent with `bun start` | Terminal shows `[archivist] started -- daytime: 0 6-22 * * *, nighttime: 0 2 * * *` |
| 3 | Wait for the next hour boundary within 6am-10pm local time | Console shows `[archivist] starting incremental run` followed by `[archivist] incremental run complete: N tokens, Nms` |
| 4 | Verify no incremental fire occurs between 10pm and 6am | No `starting incremental run` messages appear outside the configured window |
| 5 | Leave agent running overnight until 2:00am | Console shows `[archivist] starting full run` at 2am |
| 6 | Verify the full run processes all documents (check `archivist:state` document afterward) | `archivist:state` document's `mode` field shows `full`; `documents` map contains all mutable documents |

## Phase 2: Identity Propagation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Confirm `archivist:identity` document exists after startup | Document contains the seeded identity text with `<!-- archivist-identity-seeded -->` marker |
| 2 | Add logging to `SubAgentLLM.complete()` that prints the `system` parameter | Logger ready to capture sub-agent calls |
| 3 | Trigger a pipeline run via `archivist.runNow('full')` or wait for scheduled fire | Pipeline begins |
| 4 | Inspect debug output for each sub-agent `complete()` call during dedup, consolidate, crossref, prune, and reflect stages | Every sub-agent call's `system` parameter contains the identity document content |

## Phase 3: Embedding Currency

| Step | Action | Expected |
|------|--------|----------|
| 1 | Populate store with 3+ `knowledge:*` documents and generate embeddings for them | Documents and embeddings present in store |
| 2 | Run archivist pipeline that triggers a merge (create two near-duplicate documents) | Dedup stage merges one pair; winner document content updated with `<!-- merged-from: ... -->` marker |
| 3 | Query stale embeddings or check merged document's `updated_at` vs embedding `updated_at` | The merged winner document's `updated_at` is newer than its embedding's `updated_at`, marking it as stale |
| 4 | Restart the agent or trigger embedding reindexing | The stale embedding is re-generated |

## End-to-End: Full Knowledge Maintenance Cycle

1. Start with a clean store. Ingest 5 documents via the `ingest_file` tool: 2 that are near-duplicates, 2 from different sessions on the same day (archives), 1 unique knowledge document.
2. Verify embeddings are generated for all documents.
3. Trigger a full pipeline run (`archivist.runNow('full')`).
4. Verify dedup: One of the duplicate pair should be merged (check for `<!-- merged-from: -->` marker on the winner, loser deleted).
5. Verify consolidate: Same-day archives should be merged into a single `archive:consolidated:*` document with `<!-- archivist-consolidated: depth=1 -->`.
6. Verify crossref: Related documents now have `<!-- related: ... -->` markers. At least one `index:*` document exists.
7. Verify prune: Orphaned chunks (if any) are cleaned. No immutable documents (`ref:*`, `skill:*`, `customtool:*`) were touched.
8. Verify reflect: `self` document has a `<!-- archivist-managed: knowledge-domains -->` section. `operator` document has a `<!-- archivist-managed: user-patterns -->` section.
9. Check `archivist:log` contains one entry with token breakdown by stage.
10. Trigger a second full run. Verify results are stable (no duplicate processing, markers idempotent).

## End-to-End: Reference Migration

1. Create store with `knowledge:book` containing `<!-- source: reference.pdf -->` header and 12 chunks (`knowledge:book:chunk:0` through `knowledge:book:chunk:11`).
2. Start the agent (migration runs on startup).
3. Verify `knowledge:book` no longer exists.
4. Verify `ref:book` exists with identical content.
5. Verify all chunks renamed to `ref:book:chunk:0` through `ref:book:chunk:11`.
6. Verify `archivist:ref-migration` marker document exists.
7. Restart the agent. Verify migration does NOT run again (idempotent).

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| archivist.AC1.2 | Croner timing is timezone/clock dependent; unit tests verify expression is correct but not actual fire timing | Phase 1, Steps 3-4 |
| archivist.AC1.3 | Same as AC1.2; overnight fire timing requires real clock observation | Phase 1, Steps 5-6 |
| archivist.AC3.2 | Verifying propagation through every stage's sub-agent call requires instrumented observation | Phase 2, Step 4 |
| archivist.AC6.1 | `updated_at` is set by SQLite `datetime('now')` in `docUpsert()`; stale detection requires end-to-end flow | Phase 3, Steps 3-4 |
