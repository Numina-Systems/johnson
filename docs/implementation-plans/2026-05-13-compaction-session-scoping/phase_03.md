# Compaction Session Scoping Implementation Plan — Phase 3

**Goal:** Clean up orphaned `archive:<timestamp>` compaction documents that are no longer used after Phase 1 moved compaction to the `context:` prefix.

**Architecture:** A new `migrateCompactionArchives(store)` function is added to `src/archivist/migration.ts`, following the existing marker-based idempotent migration pattern established by `migrateRefsFromKnowledge()`. The migration lists all documents, identifies orphaned compaction archives (`archive:<timestamp>` — not `archive:session:*` or `archive:consolidated:*`), deletes them, and writes a marker document at `archivist:compaction-migration`. The function is called from `src/index.ts` at startup alongside the existing ref migration.

**Tech Stack:** TypeScript, bun:test, SQLite (via `src/store/store.ts`)

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-05-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-session-scoping.AC3: Orphaned compaction archives are migrated
- **compaction-session-scoping.AC3.1 Success:** Migration deletes `archive:<timestamp>` documents (old compaction format)
- **compaction-session-scoping.AC3.2 Success:** Migration preserves `archive:session:*` documents (session management archives)
- **compaction-session-scoping.AC3.3 Success:** Migration preserves `archive:consolidated:*` documents (archivist consolidations)
- **compaction-session-scoping.AC3.4 Success:** Migration writes marker document at `archivist:compaction-migration`
- **compaction-session-scoping.AC3.5 Success:** Migration is idempotent — subsequent runs are no-ops when marker exists

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add migrateCompactionArchives function

**Verifies:** compaction-session-scoping.AC3.1, compaction-session-scoping.AC3.2, compaction-session-scoping.AC3.3, compaction-session-scoping.AC3.4, compaction-session-scoping.AC3.5

**Files:**
- Modify: `src/archivist/migration.ts` (add new function after existing `migrateRefsFromKnowledge`)

**Implementation:**

Add new constants and function to `src/archivist/migration.ts` after the existing `migrateRefsFromKnowledge` function (after line 74):

```typescript
const COMPACTION_MIGRATION_MARKER = '<!-- archivist-compaction-migration-complete -->';
const COMPACTION_MIGRATION_RKEY = 'archivist:compaction-migration';

export function migrateCompactionArchives(store: Store): { deleted: number; skipped: boolean } {
  const migrationDoc = store.docGet(COMPACTION_MIGRATION_RKEY);
  if (migrationDoc?.content?.includes(COMPACTION_MIGRATION_MARKER)) {
    return { deleted: 0, skipped: true };
  }

  let deleted = 0;
  const toDelete: Array<string> = [];

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      if (!doc.rkey.startsWith('archive:')) continue;
      if (doc.rkey.startsWith('archive:session:')) continue;
      if (doc.rkey.startsWith('archive:consolidated:')) continue;
      toDelete.push(doc.rkey);
    }
    cursor = page.cursor;
  } while (cursor);

  for (const rkey of toDelete) {
    store.docDelete(rkey);
    deleted++;
  }

  store.docUpsert(COMPACTION_MIGRATION_RKEY, COMPACTION_MIGRATION_MARKER);

  return { deleted, skipped: false };
}
```

The pattern is identical to `migrateRefsFromKnowledge`:
1. Check for marker document — if present, return early with `skipped: true`
2. Iterate all documents, collect orphaned `archive:<timestamp>` rkeys (excluding `archive:session:*` and `archive:consolidated:*`)
3. Delete each orphaned document
4. Write marker document on completion
5. Return `{ deleted: count, skipped: false }`

**Verification:**

Run: `bun run build`
Expected: Builds without errors

**Commit:** `feat(archivist): add compaction archive migration to clean orphaned archive: docs`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Call migration from startup

**Verifies:** compaction-session-scoping.AC3.1

**Files:**
- Modify: `src/archivist/index.ts:89` (add barrel export)
- Modify: `src/index.ts:26` (add import) and after `src/index.ts:65` (add call OUTSIDE archivist guard)

**Implementation:**

1. Add barrel export in `src/archivist/index.ts` after the existing migration export (line 89):

```typescript
export { migrateCompactionArchives } from './migration.ts';
```

2. Update import in `src/index.ts:26` to include the new function:

```typescript
import { createArchivist, seedArchivistIdentity, migrateRefsFromKnowledge, migrateCompactionArchives } from './archivist/index.ts';
```

3. Add the migration call in `src/index.ts` AFTER the `if (config.archivist?.enabled)` block closes (after line 65), NOT inside it. Orphaned `archive:<timestamp>` compaction documents are created by the compaction system, not the archivist, so they exist regardless of archivist configuration:

```typescript
  // Migrate orphaned compaction archives from archive: to context: namespace (one-time)
  // Placed outside archivist guard — compaction orphans exist independently of archivist config
  const compactionMigration = migrateCompactionArchives(store);
  if (!compactionMigration.skipped && compactionMigration.deleted > 0) {
    log(`[migration] deleted ${compactionMigration.deleted} orphaned compaction archive(s)`);
  }
```

**Verification:**

Run: `bun run build`
Expected: Builds without errors

**Commit:** `feat(startup): call compaction archive migration during initialization`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for compaction archive migration

**Verifies:** compaction-session-scoping.AC3.1, compaction-session-scoping.AC3.2, compaction-session-scoping.AC3.3, compaction-session-scoping.AC3.4, compaction-session-scoping.AC3.5

**Files:**
- Modify: `src/archivist/migration.test.ts` (add new describe block for `migrateCompactionArchives`)

**Implementation:**

The existing test file at `src/archivist/migration.test.ts` uses `bun:test` and in-memory SQLite via `createStore(':memory:')`. Add a new describe block for `migrateCompactionArchives` after the existing `migrateRefsFromKnowledge` describe block.

Add `migrateCompactionArchives` to the import from `./migration.ts`.

Tests must verify each AC:

- **AC3.1:** Migration deletes `archive:<timestamp>` documents. Seed store with `archive:2025-01-01T00-00-00` and `archive:2025-01-02T00-00-00`, run migration, verify both are deleted via `store.docGet()` returning null.

- **AC3.2:** Migration preserves `archive:session:*` documents. Seed store with `archive:session:my-chat:2025-01-01T14-30` alongside orphaned compaction docs, run migration, verify the session doc still exists via `store.docGet()`.

- **AC3.3:** Migration preserves `archive:consolidated:*` documents. Seed store with `archive:consolidated:2025-01-01:2025-01-01T12-00-00` alongside orphaned compaction docs, run migration, verify the consolidated doc still exists via `store.docGet()`.

- **AC3.4:** Migration writes marker document. Run migration, verify `store.docGet('archivist:compaction-migration')` returns a document containing the marker string.

- **AC3.5:** Migration is idempotent. Run migration once, seed a new `archive:2025-02-01T00-00-00` doc, run migration again, verify the return value is `{ deleted: 0, skipped: true }` and the new doc still exists (migration did not delete it because marker was present).

Follow project testing patterns: `bun:test`, in-memory SQLite via `createStore(':memory:')`, `beforeEach`/`afterEach` for store lifecycle.

**Verification:**

Run: `bun test src/archivist/migration.test.ts`
Expected: All tests pass

**Commit:** `test(archivist): add compaction archive migration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
