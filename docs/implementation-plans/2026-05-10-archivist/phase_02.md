# Archivist Implementation Plan

**Goal:** Implement snapshot-based change detection (scan stage) and state persistence for the archivist.

**Architecture:** The scan stage hashes all documents via cursor-paginated iteration, compares against a persisted snapshot, and produces a `ChangeSet`. State persistence serializes/deserializes snapshots as JSON in the `archivist:state` document. Scan is Imperative Shell (store I/O); persistence functions added to `state.ts` are also Imperative Shell.

**Tech Stack:** TypeScript (Bun runtime), bun:test, node:crypto (SHA-256 hashing)

**Scope:** 8 phases from original design (phase 2 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC1: Background subsystem runs on dual schedules
- **archivist.AC1.6 Edge:** Overlapping runs (previous run still in progress when timer fires) are skipped with a log message

### archivist.AC5: State tracking across runs
- **archivist.AC5.1 Success:** Snapshot persists to `archivist:state` after each run with rkey-to-hash map
- **archivist.AC5.2 Success:** Incremental run correctly identifies added, modified, and deleted documents since last run
- **archivist.AC5.3 Success:** Full sweep processes all documents regardless of snapshot state
- **archivist.AC5.4 Edge:** First run with no existing snapshot treats all documents as added

### archivist.AC4: Immutability boundaries
- **archivist.AC4.1 Success:** `ref:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.2 Success:** `skill:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.3 Success:** `customtool:*` documents are never modified or deleted by any pipeline stage

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: State persistence -- loadSnapshot and saveSnapshot

**Verifies:** archivist.AC5.1, archivist.AC5.4

**Files:**
- Modify: `src/archivist/state.ts` (add `loadSnapshot()` and `saveSnapshot()` functions)

**Implementation:**

Add persistence functions to the existing `src/archivist/state.ts`. These are Imperative Shell functions (store I/O), so update the pattern annotation to `// pattern: Functional Core + Imperative Shell` or split if preferred. Given the codebase convention of keeping files focused, adding a comment block separating the functional core (existing pure functions) from the imperative shell (new persistence) is acceptable.

Add these functions:

```typescript
import type { Store } from '@/store/store.ts';

const STATE_RKEY = 'archivist:state';

export function loadSnapshot(store: Store): ArchivistSnapshot | null {
  const doc = store.docGet(STATE_RKEY);
  if (!doc) return null;
  return JSON.parse(doc.content) as ArchivistSnapshot;
}

export function saveSnapshot(store: Store, snapshot: ArchivistSnapshot): void {
  store.docUpsert(STATE_RKEY, JSON.stringify(snapshot));
}
```

**Testing:**

Tests for persistence are in Task 3. This task just adds the functions.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add snapshot persistence functions`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Scan stage

**Verifies:** archivist.AC5.2, archivist.AC5.3, archivist.AC5.4, archivist.AC4.1, archivist.AC4.2, archivist.AC4.3

**Files:**
- Create: `src/archivist/stages/scan.ts`

**Implementation:**

Create `src/archivist/stages/scan.ts` with pattern annotation `// pattern: Imperative Shell` (reads from store).

The scan stage:
1. Iterates all documents in the store via cursor-paginated `docList(500, cursor)`
2. Hashes each document's content with SHA-256
3. Builds a `Record<string, string>` map of rkey -> content hash
4. Loads the previous snapshot from `archivist:state` via `loadSnapshot()`
5. Calls `computeChangeSet()` (from `state.ts`, already implemented in Phase 1) to diff
6. Calls `filterMutable()` to remove immutable prefixes from mutation arrays
7. Returns the `ChangeSet` and the new hash map (for saving after the pipeline completes)

```typescript
// pattern: Imperative Shell

import { createHash } from 'node:crypto';
import type { Store } from '@/store/store.ts';
import type { ChangeSet, PipelineMode, StageResult } from '../types.ts';
import { computeChangeSet, filterMutable, loadSnapshot } from '../state.ts';

export type ScanResult = {
  readonly changeSet: ChangeSet;
  readonly currentHashes: Record<string, string>;
  readonly stageResult: StageResult;
};

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function scan(store: Store, mode: PipelineMode): ScanResult {
  const currentHashes: Record<string, string> = {};

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      currentHashes[doc.rkey] = hashContent(doc.content);
    }
    cursor = page.cursor;
  } while (cursor);

  const previous = loadSnapshot(store);
  const previousDocs = previous?.documents;

  const rawChangeSet = mode === 'full'
    ? computeChangeSet(currentHashes, undefined)
    : computeChangeSet(currentHashes, previousDocs);

  const changeSet = filterMutable(rawChangeSet);

  const totalDocs = Object.keys(currentHashes).length;
  const changedCount = changeSet.added.length + changeSet.modified.length + changeSet.deleted.length;

  return {
    changeSet,
    currentHashes,
    stageResult: {
      stage: 'scan',
      tokensUsed: 0,
      actions: [`scanned ${totalDocs} documents, ${changedCount} changes detected`],
      skipped: false,
    },
  };
}
```

Key design decisions:
- `mode === 'full'` passes `undefined` as previous to `computeChangeSet`, which treats all docs as added (per AC5.3)
- `filterMutable` strips `ref:*`, `skill:*`, `customtool:*` from mutation arrays (per AC4.1-4.3)
- Hash uses full SHA-256 hex (64 chars), not truncated like the custom tool manager
- `tokensUsed: 0` because scan doesn't use any LLM calls

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add scan stage`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Scan stage and state persistence tests

**Verifies:** archivist.AC5.1, archivist.AC5.2, archivist.AC5.3, archivist.AC5.4, archivist.AC4.1, archivist.AC4.2, archivist.AC4.3

**Files:**
- Create: `src/archivist/stages/scan.test.ts`

**Implementation:**

Create `src/archivist/stages/scan.test.ts` with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test`. Tests use an in-memory store via `createStore(':memory:')` (same pattern as `src/store/store.test.ts`). Import `createStore` from `@/store/store.ts`.

The `createStore` function signature is: `createStore(dbPath: string): Store`. Passing `':memory:'` creates an in-memory SQLite database.

Tests must verify:

**Scan stage:**
- archivist.AC5.4: First scan with empty store produces empty ChangeSet
- archivist.AC5.4: First scan with documents and no prior snapshot treats all as added
- archivist.AC5.2: Scan detects added documents (new doc since last snapshot)
- archivist.AC5.2: Scan detects modified documents (content changed since last snapshot)
- archivist.AC5.2: Scan detects deleted documents (doc removed since last snapshot)
- archivist.AC5.2: Scan detects unchanged documents (same content and hash)
- archivist.AC5.3: Full sweep mode treats all documents as added regardless of snapshot
- archivist.AC4.1/4.2/4.3: Scan filters immutable prefixes from mutation arrays (add `ref:book`, `skill:test`, `customtool:foo` documents, verify they appear in `unchanged` but not in `added/modified/deleted` of the filtered result)

**State persistence:**
- archivist.AC5.1: `saveSnapshot` persists to `archivist:state`, `loadSnapshot` reads it back
- `loadSnapshot` returns null when no state document exists

Test pattern for each scan test:
1. Create in-memory store
2. Upsert documents to simulate state
3. Optionally save a previous snapshot
4. Run `scan(store, mode)`
5. Assert ChangeSet contents

**Verification:**

```bash
bun test src/archivist/stages/scan.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add scan stage and state persistence tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
