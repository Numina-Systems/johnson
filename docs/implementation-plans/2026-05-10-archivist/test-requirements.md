# Test Requirements: Archivist Background Agent

## Automated Tests

### archivist.AC1: Background subsystem runs on dual schedules

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC1.1 | Archivist starts two croner timers on `archivist.start()` -- daytime incremental and overnight full sweep | unit | `src/archivist/pipeline.test.ts` | 7 |
| archivist.AC1.2 | Daytime timer fires hourly between 6am-10pm in the configured timezone | unit | `src/archivist/pipeline.test.ts` | 7 |
| archivist.AC1.3 | Overnight timer fires at 2am in the configured timezone | unit | `src/archivist/pipeline.test.ts` | 7 |
| archivist.AC1.4 | `archivist.stop()` cancels both timers cleanly | unit | `src/archivist/pipeline.test.ts` | 7 |
| archivist.AC1.5 | If archivist is disabled in config, no timers are created and no pipeline runs occur | unit | `src/config/loader.test.ts`, `src/archivist/pipeline.test.ts` | 1, 7 |
| archivist.AC1.6 | Overlapping runs (previous run still in progress when timer fires) are skipped with a log message | unit | `src/archivist/pipeline.test.ts` | 7 |

### archivist.AC2: Automated knowledge maintenance operations

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC2.1 | Dedup identifies documents with embedding similarity >= configured threshold as candidates | integration | `src/archivist/stages/dedup.test.ts` | 3 |
| archivist.AC2.2 | Dedup merges confirmed duplicates, keeping the winner with `<!-- merged-from: ... -->` marker and deleting the loser + chunks | integration | `src/archivist/stages/dedup.test.ts` | 3 |
| archivist.AC2.3 | Consolidate groups same-day archives and synthesizes them into a single summary | integration | `src/archivist/stages/consolidate.test.ts` | 4 |
| archivist.AC2.4 | Cross-reference adds idempotent `<!-- related: ... -->` markers to documents with embedding similarity >= crossref threshold | integration | `src/archivist/stages/crossref.test.ts` | 5 |
| archivist.AC2.5 | Cross-reference creates/updates `index:*` topic cluster documents | integration | `src/archivist/stages/crossref.test.ts` | 5 |
| archivist.AC2.6 | Prune removes documents confirmed as strict information subsets of another document | integration | `src/archivist/stages/prune.test.ts` | 3 |
| archivist.AC2.7 | Prune cleans up orphaned chunk documents whose parent no longer exists | integration | `src/archivist/stages/prune.test.ts` | 3 |
| archivist.AC2.8 | Reflect updates archivist-managed sections in `self` with knowledge domain observations | integration | `src/archivist/stages/reflect.test.ts` | 6 |
| archivist.AC2.9 | Reflect updates archivist-managed sections in `operator` with cross-session user patterns | integration | `src/archivist/stages/reflect.test.ts` | 6 |
| archivist.AC2.10 | Sub-agent returns uncertain result for dedup candidate -- documents are left separate | integration | `src/archivist/stages/dedup.test.ts` | 3 |
| archivist.AC2.11 | Store contains only immutable documents -- pipeline completes with no mutations | integration | `src/archivist/stages/dedup.test.ts` | 3 |

### archivist.AC3: Own identity document

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC3.1 | `archivist:identity` document is seeded on first run with the configured identity content | unit | `src/archivist/seed.test.ts` | 8 |
| archivist.AC3.2 | Identity content is passed as system prompt to all sub-agent calls | integration | `src/archivist/pipeline.test.ts` | 8 |
| archivist.AC3.3 | Identity already exists -- seeding is a no-op | unit | `src/archivist/seed.test.ts` | 8 |

### archivist.AC4: Immutability boundaries

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC4.1 | `ref:*` documents are never modified or deleted by any pipeline stage | integration | `src/archivist/stages/scan.test.ts`, `src/archivist/stages/dedup.test.ts`, `src/archivist/stages/prune.test.ts` | 2, 3 |
| archivist.AC4.2 | `skill:*` documents are never modified or deleted by any pipeline stage | integration | `src/archivist/stages/scan.test.ts`, `src/archivist/stages/dedup.test.ts`, `src/archivist/stages/prune.test.ts` | 2, 3 |
| archivist.AC4.3 | `customtool:*` documents are never modified or deleted by any pipeline stage | integration | `src/archivist/stages/scan.test.ts`, `src/archivist/stages/dedup.test.ts`, `src/archivist/stages/prune.test.ts` | 2, 3 |
| archivist.AC4.4 | Ref migration moves existing reference books from `knowledge:*` to `ref:*` with chunks renamed | integration | `src/archivist/migration.test.ts`, `src/tools/ingest.test.ts` | 8 |
| archivist.AC4.5 | Migration runs only once -- subsequent startups are no-ops (marker-based idempotency) | unit | `src/archivist/migration.test.ts` | 8 |

### archivist.AC5: State tracking across runs

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC5.1 | Snapshot persists to `archivist:state` after each run with rkey-to-hash map | integration | `src/archivist/stages/scan.test.ts` | 2 |
| archivist.AC5.2 | Incremental run correctly identifies added, modified, and deleted documents since last run | unit | `src/archivist/state.test.ts`, `src/archivist/stages/scan.test.ts` | 1, 2 |
| archivist.AC5.3 | Full sweep processes all documents regardless of snapshot state | integration | `src/archivist/stages/scan.test.ts` | 2 |
| archivist.AC5.4 | First run with no existing snapshot treats all documents as added | unit | `src/archivist/state.test.ts`, `src/archivist/stages/scan.test.ts` | 1, 2 |

### archivist.AC6: Embeddings stay current

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC6.1 | Documents modified by the archivist have updated `updated_at` timestamps triggering existing stale-embedding detection | integration | `src/archivist/pipeline.test.ts` | 7 |

### archivist.AC7: Token budget and logging

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC7.1 | Each pipeline run logs token usage breakdown by stage to `archivist:log` | unit | `src/archivist/logging.test.ts` | 7 |
| archivist.AC7.2 | When soft budget is exceeded, pipeline finishes current operation and skips remaining stages | integration | `src/archivist/pipeline.test.ts` | 7 |
| archivist.AC7.3 | `archivist:log` maintains a rolling window of the last N entries (configurable) | unit | `src/archivist/logging.test.ts` | 7 |
| archivist.AC7.4 | Token budget of 0 means unlimited -- `shouldContinue()` always returns true | unit | `src/archivist/budget.test.ts` | 1 |

### archivist.AC8: Full edit access to self and operator

| AC | Description | Test Type | Test File | Phase |
|---|---|---|---|---|
| archivist.AC8.1 | Archivist can create new archivist-managed sections in `self` and `operator` | unit | `src/archivist/stages/reflect.test.ts` | 6 |
| archivist.AC8.2 | Archivist can rewrite content within its `<!-- archivist-managed -->` markers | unit | `src/archivist/stages/reflect.test.ts` | 6 |
| archivist.AC8.3 | Archivist never modifies content outside `<!-- archivist-managed -->` markers in `self` or `operator` | unit | `src/archivist/stages/reflect.test.ts` | 6 |

## Human Verification

| AC | Description | Why Not Automated | Verification Approach |
|---|---|---|---|
| archivist.AC1.2 | Daytime timer fires hourly between 6am-10pm in the configured timezone | Croner schedule timing is timezone-dependent and non-deterministic in CI; the cron expression is well-tested by the croner library. Unit tests verify the expression is passed correctly to `Cron`, but actual fire timing requires real clock observation. | 1. Configure `[archivist]` with `daytime_schedule = "0 6-22 * * *"` and a known timezone. 2. Start the agent. 3. Observe `[archivist] starting incremental run` log messages appear on the hour within the 6am-10pm window. 4. Confirm no fires outside that window. |
| archivist.AC1.3 | Overnight timer fires at 2am in the configured timezone | Same as AC1.2 -- actual cron fire timing depends on system clock and timezone. | 1. Configure `[archivist]` with `nighttime_schedule = "0 2 * * *"` and a known timezone. 2. Leave the agent running overnight. 3. Observe `[archivist] starting full run` log message at 2am. 4. Confirm it runs a full sweep. |
| archivist.AC3.2 | Identity content is passed as system prompt to all sub-agent calls | While pipeline-level wiring is testable, confirming propagation through every stage's sub-agent call requires either per-stage instrumented mocks (fragile) or runtime observation. | 1. Seed `archivist:identity` with distinctive content. 2. Enable debug logging on sub-agent calls. 3. Run a full pipeline. 4. Verify the identity content appears in the `system` parameter of every sub-agent `complete()` call. |
| archivist.AC6.1 | Documents modified by the archivist have updated `updated_at` timestamps | The `updated_at` is set by `docUpsert()` (SQLite `datetime('now')`), not archivist code. Verifying stale-embedding detection picks up archivist-modified docs requires an end-to-end flow spanning store, archivist, and embedding reindexing. | 1. Populate store with documents and embeddings. 2. Run archivist pipeline (trigger a merge/reflect). 3. Call `getStaleEmbeddings()` and verify modified documents appear. 4. Confirm reindexing on next startup picks them up. |

## Test File Summary

| Test File | Phase | AC Coverage |
|---|---|---|
| `src/config/loader.test.ts` | 1 | AC1.5 |
| `src/archivist/budget.test.ts` | 1 | AC7.4 |
| `src/archivist/state.test.ts` | 1 | AC5.2, AC5.4 |
| `src/archivist/stages/scan.test.ts` | 2 | AC4.1, AC4.2, AC4.3, AC5.1, AC5.2, AC5.3, AC5.4 |
| `src/archivist/stages/dedup.test.ts` | 3 | AC2.1, AC2.2, AC2.10, AC2.11, AC4.1, AC4.2, AC4.3 |
| `src/archivist/stages/prune.test.ts` | 3 | AC2.6, AC2.7, AC4.1, AC4.2, AC4.3 |
| `src/archivist/stages/consolidate.test.ts` | 4 | AC2.3 |
| `src/archivist/stages/crossref.test.ts` | 5 | AC2.4, AC2.5 |
| `src/archivist/stages/reflect.test.ts` | 6 | AC2.8, AC2.9, AC8.1, AC8.2, AC8.3 |
| `src/archivist/pipeline.test.ts` | 7 | AC1.1, AC1.4, AC1.5, AC1.6, AC6.1, AC7.2 |
| `src/archivist/logging.test.ts` | 7 | AC7.1, AC7.3 |
| `src/archivist/seed.test.ts` | 8 | AC3.1, AC3.3 |
| `src/archivist/migration.test.ts` | 8 | AC4.4, AC4.5 |
| `src/tools/ingest.test.ts` | 8 | AC4.4 |
