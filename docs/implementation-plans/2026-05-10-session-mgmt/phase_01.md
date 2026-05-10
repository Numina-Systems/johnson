# Session Management Implementation Plan — Phase 1

**Goal:** Add shared types for session management and a `listSessionsWithCounts()` method to the Store that returns sessions with message counts in a single query.

**Architecture:** New `src/sessions/types.ts` file defines the shared types used by all subsequent phases. The Store interface in `src/store/store.ts` gains one new method backed by a LEFT JOIN query, replacing the current N+1 pattern used by the TUI.

**Tech Stack:** TypeScript, bun:sqlite, bun:test

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-mgmt.AC1: Store lists sessions with message counts
- **session-mgmt.AC1.1 Success:** `listSessionsWithCounts()` returns sessions with accurate `messageCount` values
- **session-mgmt.AC1.2 Success:** Sessions with 0 messages return `messageCount: 0` and `lastMessageAt: null`
- **session-mgmt.AC1.3 Edge:** Results ordered by `updatedAt DESC`, respects optional `limit` parameter

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/sessions/types.ts` with shared types

**Files:**
- Create: `src/sessions/types.ts`

**Implementation:**

Create the types file with all four types needed across the session management feature. This is a type-only file (no runtime behaviour, no pattern comment needed).

```typescript
export type SessionWithCounts = {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly lastMessageAt: string | null;
};

export type SessionClassification = 'delete' | 'archive' | 'active';

export type ArchiveResult = {
  readonly rkey: string;
  readonly title: string | null;
  readonly messageCount: number;
};

export type PruneResult = {
  readonly deleted: number;
  readonly archived: number;
  readonly details: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly action: 'deleted' | 'archived';
    readonly rkey?: string;
  }>;
};
```

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(sessions): add shared types for session management`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `listSessionsWithCounts()` to Store interface and implementation

**Verifies:** session-mgmt.AC1.1, session-mgmt.AC1.2, session-mgmt.AC1.3

**Files:**
- Modify: `src/store/store.ts:1` (add import for `SessionWithCounts`)
- Modify: `src/store/store.ts:54-64` (add method to Store interface, in the Sessions section)
- Modify: `src/store/store.ts:276-309` (add prepared statement alongside other session statements)
- Modify: `src/store/store.ts:440-443` (add method implementation near existing `listSessions`)
- Modify: `src/agent/agent.test.ts:23-59` (add `listSessionsWithCounts` to `createNoopStore()`)

**Implementation:**

Add import at top of file:

```typescript
import type { SessionWithCounts } from '../sessions/types.ts';
```

Add to the Store interface after `listSessions` (line 58):

```typescript
listSessionsWithCounts(limit?: number): Array<SessionWithCounts>;
```

Add prepared statement alongside other session statements (after `stmtSessionMessageCount` around line 309):

```typescript
const stmtListSessionsWithCounts = db.prepare(
  `SELECT s.id, s.title, s.created_at, s.updated_at,
          COUNT(m.id) AS message_count,
          MAX(m.created_at) AS last_message_at
   FROM sessions s
   LEFT JOIN messages m ON m.session_id = s.id
   GROUP BY s.id
   ORDER BY s.updated_at DESC
   LIMIT ?`,
);
```

Add method implementation after existing `listSessions` method (after line 443):

```typescript
listSessionsWithCounts(limit = 50): Array<SessionWithCounts> {
  const rows = stmtListSessionsWithCounts.all(limit) as Array<{
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    message_count: number;
    last_message_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
  }));
},
```

Update the noop Store mock in `src/agent/agent.test.ts` — add `listSessionsWithCounts: () => [],` to the `createNoopStore()` function (around line 38, in the Sessions section alongside `listSessions`). This prevents type errors since `createNoopStore()` fully implements the `Store` interface.

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(store): add listSessionsWithCounts query`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for `listSessionsWithCounts()`

**Verifies:** session-mgmt.AC1.1, session-mgmt.AC1.2, session-mgmt.AC1.3

**Files:**
- Create: `src/store/store.test.ts`

**Testing:**

This is the first test file for the Store module. Since Store is backed by bun:sqlite and the factory function `createStore(dbPath)` accepts a path, use an in-memory database by passing `":memory:"` — bun:sqlite supports this natively. This avoids temp file cleanup and tests against real SQLite behaviour rather than mocks.

Pattern comment: `// pattern: Imperative Shell (test)`

Tests must verify each AC listed:

- **session-mgmt.AC1.1:** Create a session, append several messages, call `listSessionsWithCounts()`. Assert `messageCount` matches the number of messages appended.
- **session-mgmt.AC1.2:** Create a session with no messages. Call `listSessionsWithCounts()`. Assert `messageCount` is `0` and `lastMessageAt` is `null`.
- **session-mgmt.AC1.3:** Create multiple sessions with different `updatedAt` timestamps (append messages at different times or update titles to change `updated_at`). Call `listSessionsWithCounts()` and assert results are ordered by `updatedAt` descending. Also call with a `limit` of 1 and assert only 1 result is returned.

Use `createStore(":memory:")` for test setup. Import from `bun:test`: `describe`, `expect`, `test`.

**Verification:**

Run: `bun test src/store/store.test.ts`
Expected: All tests pass

**Commit:** `test(store): add listSessionsWithCounts tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
