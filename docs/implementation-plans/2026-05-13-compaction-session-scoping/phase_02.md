# Compaction Session Scoping Implementation Plan — Phase 2

**Goal:** Prevent the archivist from modifying compaction archives stored under the `context:` prefix.

**Architecture:** The archivist uses an `IMMUTABLE_PREFIXES` array in `src/archivist/state.ts` to gate mutations. Adding `'context:'` to this array makes `isImmutable()` return true for all `context:*` rkeys, and `filterMutable()` strips them from changesets before any archivist stage applies mutations. The `isArchiveRkey()` function in `consolidate.ts` matches `archive:*` — since Phase 1 moved compaction docs to `context:*`, they naturally fall out of archive consolidation without any code changes to `consolidate.ts`.

**Tech Stack:** TypeScript, bun:test

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-05-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-session-scoping.AC2: Archivist does not modify compaction archives
- **compaction-session-scoping.AC2.1 Success:** `isImmutable()` returns true for `context:*` rkeys
- **compaction-session-scoping.AC2.2 Success:** `filterMutable()` removes `context:*` documents from archivist changesets
- **compaction-session-scoping.AC2.3 Success:** Archivist consolidation (`isArchiveRkey()`) does not match `context:*` rkeys

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add context: to IMMUTABLE_PREFIXES

**Verifies:** compaction-session-scoping.AC2.1, compaction-session-scoping.AC2.2

**Files:**
- Modify: `src/archivist/state.ts:6` (IMMUTABLE_PREFIXES constant)

**Implementation:**

At `src/archivist/state.ts:6`, add `'context:'` to the `IMMUTABLE_PREFIXES` array:

```typescript
const IMMUTABLE_PREFIXES = ['ref:', 'skill:', 'customtool:', 'context:'] as const;
```

No other changes needed. `isImmutable()` (lines 9-11) iterates this array with `.some()`, so adding the entry is sufficient. `filterMutable()` (lines 46-53) delegates to `isImmutable()`, so it automatically picks up the new prefix.

**Verification:**

Run: `bun run build`
Expected: Builds without errors

**Commit:** `feat(archivist): add context: to immutable prefixes`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for archivist isolation of context: prefix

**Verifies:** compaction-session-scoping.AC2.1, compaction-session-scoping.AC2.2, compaction-session-scoping.AC2.3

**Files:**
- Modify: `src/archivist/state.test.ts` (add tests to existing `isImmutable` and `filterMutable` describe blocks)

**Implementation:**

The existing test file at `src/archivist/state.test.ts` uses `bun:test` and has describe blocks for `isImmutable` (lines 12-40) and `filterMutable` (lines 146-214).

1. **Add to the `isImmutable` describe block** (after line 39, before the closing `}`):

Add a test verifying `context:*` rkeys are immutable:

```typescript
test('returns true for context: prefix', () => {
  expect(isImmutable('context:abc:2026-05-13T12-00-00')).toBe(true);
});
```

2. **Add to the `filterMutable` describe block** (after the existing tests):

Add a test verifying `context:*` rkeys are filtered from changesets:

```typescript
test('removes context: rkeys from all changeset lists', () => {
  const changeSet: ChangeSet = {
    added: ['context:session-1:2026-05-13T12-00-00', 'knowledge:real-doc'],
    modified: ['context:session-2:2026-05-13T13-00-00'],
    deleted: ['context:default:2026-05-13T14-00-00'],
    unchanged: ['context:session-1:2026-05-13T11-00-00'],
  };
  const filtered = filterMutable(changeSet);
  expect(filtered.added).toEqual(['knowledge:real-doc']);
  expect(filtered.modified).toEqual([]);
  expect(filtered.deleted).toEqual([]);
  expect(filtered.unchanged).toEqual(['context:session-1:2026-05-13T11-00-00']);
});
```

3. **Verify AC2.3 — consolidation exclusion.** The existing test file at `src/archivist/stages/consolidate.test.ts` has tests for `isArchiveRkey()` at lines 48-66. Add a test verifying `context:*` rkeys are NOT matched:

**Files:**
- Modify: `src/archivist/stages/consolidate.test.ts` (add test to existing `isArchiveRkey` describe block)

```typescript
test('returns false for context: prefix', () => {
  expect(isArchiveRkey('context:session-1:2026-05-13T12-00-00')).toBe(false);
});
```

**Testing:**

Tests must verify each AC listed above:
- compaction-session-scoping.AC2.1: `isImmutable('context:abc:2026-05-13T12-00-00')` returns true
- compaction-session-scoping.AC2.2: `filterMutable()` strips `context:*` from added/modified/deleted lists, preserves in unchanged
- compaction-session-scoping.AC2.3: `isArchiveRkey('context:...')` returns false (context docs are not archive docs)

Follow project testing patterns: `bun:test`, existing describe block structure, pattern marker already present.

**Verification:**

Run: `bun test src/archivist/state.test.ts src/archivist/stages/consolidate.test.ts`
Expected: All tests pass

**Commit:** `test(archivist): verify context: prefix is immutable and excluded from consolidation`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
