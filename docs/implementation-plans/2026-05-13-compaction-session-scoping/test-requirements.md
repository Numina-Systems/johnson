# Test Requirements: Compaction Session Scoping

Maps each acceptance criterion from the [design plan](../../design-plans/2026-05-13-compaction-session-scoping.md) to automated tests or documented human verification.

---

## AC1: Compaction is session-scoped

### compaction-session-scoping.AC1.1

> Compaction writes documents with rkey `context:<sessionId>:<timestamp>`

- **Verification:** Automated (unit test)
- **Test file:** `src/agent/compaction.test.ts`
- **Test name:** `writes context document with session-scoped rkey`
- **What it verifies:** After calling `compactContext()` with `sessionId: 'test-session'`, the upserted rkey matches the regex `^context:test-session:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$`. Confirms the prefix changed from `archive:` to `context:<sessionId>:` and the timestamp segment is well-formed.

### compaction-session-scoping.AC1.2

> `listContextDocs()` returns only documents matching the current session's prefix

- **Verification:** Automated (unit test)
- **Test file:** `src/agent/compaction.test.ts`
- **Test name:** `sessions do not see each other's context documents` (covers AC1.2 implicitly)
- **What it verifies:** A mock store is seeded with documents from both `session-a` and `session-b`. When `compactContext()` runs for `session-a`, the resulting compaction message contains no content from `session-b`'s documents, and vice versa. This proves `listContextDocs()` filters correctly because compaction only processes what `listContextDocs()` returns.
- **Note:** `listContextDocs` is a private function. Its behaviour is verified indirectly through `compactContext()`, which is the public surface.

### compaction-session-scoping.AC1.3

> Two concurrent sessions with different IDs produce independent context archives that do not cross-contaminate

- **Verification:** Automated (unit test)
- **Test file:** `src/agent/compaction.test.ts`
- **Test name:** `sessions do not see each other's context documents`
- **What it verifies:** Bidirectional isolation. Session A's compaction output does not contain session B's content, and session B's compaction output does not contain session A's content. Both sessions' upserted rkeys start with their respective session-scoped prefixes (`context:session-a:` and `context:session-b:`). The test seeds both sessions' docs into the same store instance, simulating shared-database concurrent access.

### compaction-session-scoping.AC1.4

> Summarization in `compactContext()` only processes the current session's older documents

- **Verification:** Automated (unit test)
- **Test file:** `src/agent/compaction.test.ts`
- **Test name:** `uses sub-agent for summarization when older context docs exist` (existing test, updated with session-scoped data)
- **What it verifies:** The existing summarization test is updated so mock documents use `context:session-1:*` rkeys and `compactContext()` is called with `sessionId: 'session-1'`. The sub-agent receives only this session's older documents for summarization. Combined with AC1.3's cross-session test, this confirms summarization never processes another session's context.

### compaction-session-scoping.AC1.5

> When `sessionId` is not provided, compaction uses `"default"` as fallback and operates correctly in its own namespace

- **Verification:** Automated (unit test)
- **Test file:** `src/agent/compaction.test.ts`
- **Test name:** `uses "default" session when sessionId is not provided`
- **What it verifies:** Calling `compactContext(messages, { store, subAgent })` (no `sessionId` in deps) produces an upserted rkey starting with `context:default:`. Confirms the fallback value is applied and the document lands in a valid, isolated namespace.

---

## AC2: Archivist does not modify compaction archives

### compaction-session-scoping.AC2.1

> `isImmutable()` returns true for `context:*` rkeys

- **Verification:** Automated (unit test)
- **Test file:** `src/archivist/state.test.ts`
- **Test name:** `returns true for context: prefix`
- **What it verifies:** `isImmutable('context:abc:2026-05-13T12-00-00')` returns `true`. Direct assertion on the function's return value with a realistic rkey.

### compaction-session-scoping.AC2.2

> `filterMutable()` removes `context:*` documents from archivist changesets

- **Verification:** Automated (unit test)
- **Test file:** `src/archivist/state.test.ts`
- **Test name:** `removes context: rkeys from all changeset lists`
- **What it verifies:** A `ChangeSet` is constructed with `context:*` rkeys in `added`, `modified`, and `deleted` lists (plus one legitimate `knowledge:` rkey in `added`). After `filterMutable()`, all `context:*` rkeys are stripped from `added`, `modified`, and `deleted`. The `unchanged` list retains `context:*` rkeys (per existing behaviour). The single `knowledge:` rkey survives in `added`.

### compaction-session-scoping.AC2.3

> Archivist consolidation (`isArchiveRkey()`) does not match `context:*` rkeys

- **Verification:** Automated (unit test)
- **Test file:** `src/archivist/stages/consolidate.test.ts`
- **Test name:** `returns false for context: prefix`
- **What it verifies:** `isArchiveRkey('context:session-1:2026-05-13T12-00-00')` returns `false`. Confirms the consolidation stage's rkey classifier correctly excludes `context:*`.

---

## AC3: Orphaned compaction archives are migrated

### compaction-session-scoping.AC3.1

> Migration deletes `archive:<timestamp>` documents (old compaction format)

- **Verification:** Automated (integration test)
- **Test file:** `src/archivist/migration.test.ts`
- **Test name:** `deletes orphaned archive:<timestamp> documents`
- **What it verifies:** Seeds an in-memory SQLite store (via `createStore(':memory:')`) with documents like `archive:2025-01-01T00-00-00` and `archive:2025-01-02T00-00-00`. After `migrateCompactionArchives(store)`, both are gone (`store.docGet()` returns null). Return value confirms `{ deleted: 2, skipped: false }`.

### compaction-session-scoping.AC3.2

> Migration preserves `archive:session:*` documents (session management archives)

- **Verification:** Automated (integration test)
- **Test file:** `src/archivist/migration.test.ts`
- **Test name:** `preserves archive:session:* documents`
- **What it verifies:** Seeds store with `archive:session:my-chat:2025-01-01T14-30` alongside orphaned compaction docs. After migration, `store.docGet('archive:session:my-chat:2025-01-01T14-30')` still returns the document with its original content.

### compaction-session-scoping.AC3.3

> Migration preserves `archive:consolidated:*` documents (archivist consolidations)

- **Verification:** Automated (integration test)
- **Test file:** `src/archivist/migration.test.ts`
- **Test name:** `preserves archive:consolidated:* documents`
- **What it verifies:** Seeds store with `archive:consolidated:2025-01-01:2025-01-01T12-00-00` alongside orphaned compaction docs. After migration, the consolidated doc still exists via `store.docGet()`.

### compaction-session-scoping.AC3.4

> Migration writes marker document at `archivist:compaction-migration`

- **Verification:** Automated (integration test)
- **Test file:** `src/archivist/migration.test.ts`
- **Test name:** `writes marker document after migration`
- **What it verifies:** After running `migrateCompactionArchives(store)`, `store.docGet('archivist:compaction-migration')` returns a document whose content includes `<!-- archivist-compaction-migration-complete -->`.

### compaction-session-scoping.AC3.5

> Migration is idempotent — subsequent runs are no-ops when marker exists

- **Verification:** Automated (integration test)
- **Test file:** `src/archivist/migration.test.ts`
- **Test name:** `is idempotent when marker exists`
- **What it verifies:** Runs migration once (deletes orphans, writes marker). Seeds a new `archive:2025-02-01T00-00-00` document. Runs migration again. Second invocation returns `{ deleted: 0, skipped: true }`. The newly seeded document still exists.

---

## AC4: Documentation is updated

### compaction-session-scoping.AC4.1

> CLAUDE.md lists `context:<sessionId>:<timestamp>` in rkey prefix documentation

- **Verification:** Human verification
- **Justification:** Documentation prose change. Automated testing of markdown content is brittle and couples tests to formatting.
- **Verification approach:** After Phase 4 Tasks 1 and 2, open `CLAUDE.md` and confirm:
  1. The rkey prefix list contains `context:<sessionId>:<timestamp>` with description "session-scoped context compaction snapshots"
  2. The compaction description paragraph references `context:<sessionId>:<timestamp>` and describes session scoping
  3. `archivist:compaction-migration` appears in the rkey prefix list

### compaction-session-scoping.AC4.2

> CLAUDE.md lists `context:*` as an immutable prefix

- **Verification:** Human verification
- **Justification:** Documentation prose — updating a count and adding a bullet point.
- **Verification approach:** After Phase 4 Task 3, open `CLAUDE.md` and confirm:
  1. The "Immutability Boundaries" section says "four immutable prefixes" (not "three")
  2. `context:*` appears in the immutability list with description "Session-scoped compaction snapshots. Transient context managed by compaction, not durable knowledge."
  3. The "New rkey Prefixes" section includes `context:*`

### compaction-session-scoping.AC4.3

> CLAUDE.md no longer references `archive:<timestamp>` as a compaction rkey format

- **Verification:** Human verification
- **Justification:** Verifying absence of a string in markdown is straightforward human inspection.
- **Verification approach:** After all Phase 4 tasks:
  1. Search `CLAUDE.md` for `archive:<timestamp>` — should not appear as a current/active rkey format
  2. The rkey prefix list should have `context:<sessionId>:<timestamp>` where `archive:<timestamp>` previously was
  3. The compaction description should reference `context:`, not `archive:`, for compaction snapshots

---

## Summary

| AC Group | Total ACs | Automated | Human Verification |
|----------|-----------|-----------|-------------------|
| AC1: Session-scoped compaction | 5 | 5 | 0 |
| AC2: Archivist isolation | 3 | 3 | 0 |
| AC3: Migration | 5 | 5 | 0 |
| AC4: Documentation | 3 | 0 | 3 |
| **Total** | **16** | **13** | **3** |

All three human-verification ACs are documentation changes to `CLAUDE.md`. The remaining 13 ACs are covered by automated tests across four test files:

- `src/agent/compaction.test.ts` — 5 tests (AC1.1 through AC1.5)
- `src/archivist/state.test.ts` — 2 tests (AC2.1, AC2.2)
- `src/archivist/stages/consolidate.test.ts` — 1 test (AC2.3)
- `src/archivist/migration.test.ts` — 5 tests (AC3.1 through AC3.5)
