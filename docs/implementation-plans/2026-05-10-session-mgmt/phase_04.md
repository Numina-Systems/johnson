# Session Management Implementation Plan — Phase 4

**Goal:** Register session management sandbox tools (`list_sessions`, `archive_session`, `delete_session`) callable from `execute_code`, and wire them into the agent's tool registry.

**Architecture:** New `src/tools/sessions.ts` module following the `register*Tools(registry, deps)` pattern used by `web.ts`, `notify.ts`, `image.ts`, etc. Tools are registered in `sandbox` mode (the default) so they generate Deno TypeScript stubs and prompt documentation. Tool handlers delegate to `archiver.archiveSession()` and `store.deleteSession()` from prior phases.

**Tech Stack:** TypeScript, bun:test

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-mgmt.AC4: Sandbox tools callable from execute_code
- **session-mgmt.AC4.1 Success:** `tools.list_sessions()` returns all sessions with metadata and classification
- **session-mgmt.AC4.2 Success:** `tools.list_sessions({ filter: "stale" })` returns only stale-classified sessions
- **session-mgmt.AC4.3 Success:** `tools.archive_session({ session_id })` archives and returns the archive rkey
- **session-mgmt.AC4.4 Success:** `tools.delete_session({ session_id })` deletes session and messages

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/tools/sessions.ts` with tool registration

**Files:**
- Create: `src/tools/sessions.ts`

**Implementation:**

Pattern comment: `// pattern: Imperative Shell — session management sandbox tools`

**Imports:**

```typescript
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { classifySession } from '../sessions/archive.ts';
import { archiveSession } from '../sessions/archiver.ts';
```

**Local helpers** (same pattern as other tool modules):

```typescript
function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === 'string' ? val : undefined;
}
```

**Export function:**

```typescript
export function registerSessionTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void
```

Register three tools inside this function:

**`list_sessions`:**
- Description: "List all conversation sessions with metadata and classification. Optionally filter by classification."
- Parameters: `{ filter?: string }` — optional, one of `"stale"`, `"active"`, `"delete"`, `"archive"`
- Handler:
  1. Call `deps.store.listSessionsWithCounts()`
  2. For each session, call `classifySession(s.messageCount, s.updatedAt, new Date())` to compute classification
  3. If `filter` param is provided:
     - `"stale"` → return sessions classified as `"delete"` or `"archive"`
     - `"active"` / `"delete"` / `"archive"` → return sessions matching that classification
  4. Return the array of sessions with their classification added

**`archive_session`:**
- Description: "Archive a conversation session. Creates an archive document in the document store and deletes the original session."
- Parameters: `{ session_id: string }` — required
- Handler:
  1. Call `archiveSession(sessionId, deps.store, deps.subAgent, deps.embedding)` from the archiver module. The `embeddingModel` parameter is omitted — the archiver defaults to `'nomic-embed-text'`, consistent with all other callers in the codebase (`src/tools/ingest.ts`, `src/agent/tools.ts`).
  2. Return a string like `"Archived session as ${result.rkey}"`
  3. Throw on error (e.g., session not found)

**`delete_session`:**
- Description: "Delete a conversation session and all its messages. This is permanent and cannot be undone."
- Parameters: `{ session_id: string }` — required
- Handler:
  1. Call `deps.store.deleteSession(sessionId)`
  2. If returns `false`, throw `"Session not found: ${sessionId}"`
  3. Return `"Deleted session ${sessionId}"`

All three tools use default `sandbox` mode (omit the mode parameter from `registry.register()`).

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tools): add session management sandbox tools`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire `registerSessionTools` into `createAgentTools()`

**Files:**
- Modify: `src/agent/tools.ts:13` (add import)
- Modify: `src/agent/tools.ts:414` (add registration call)

**Implementation:**

Add import after existing tool imports (after line 13):

```typescript
import { registerSessionTools } from '../tools/sessions.ts';
```

Add registration call after the ingest tools block (after line 414, before `return registry;`):

```typescript
// Session management tools
registerSessionTools(registry, deps);
```

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tools): wire session tools into agent`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for session management tools

**Verifies:** session-mgmt.AC4.1, session-mgmt.AC4.2, session-mgmt.AC4.3, session-mgmt.AC4.4

**Files:**
- Create: `src/tools/sessions.test.ts`

**Testing:**

Pattern comment: `// pattern: Imperative Shell (test)`

Create a mock store and mock dependencies, register the tools into a real `ToolRegistry` via `createToolRegistry()`, then call handlers through `registry.execute()`.

Test helper:
- Create a `createMockDeps()` function that returns an `AgentDependencies`-shaped object with a mock store (tracking calls to `listSessionsWithCounts`, `deleteSession`, `docUpsert`), mock subAgent, mock embedding
- Call `registerSessionTools(registry, mockDeps)` in test setup

Tests must verify each AC:

- **session-mgmt.AC4.1:** Call `registry.execute('list_sessions', {})`. Assert it returns all sessions from mock store with `classification` field added to each. Verify the classification is computed correctly (e.g., old empty session → `"delete"`, old session with messages → `"archive"`, recent session → `"active"`).

- **session-mgmt.AC4.2:** Call `registry.execute('list_sessions', { filter: 'stale' })`. Set up mock store with sessions of different classifications. Assert only sessions classified as `"delete"` or `"archive"` are returned.

- **session-mgmt.AC4.3:** Call `registry.execute('archive_session', { session_id: 'test-id' })`. Assert `docUpsert` was called (archive document created), `deleteSession` was called (original deleted). Assert the return value contains the rkey string.

- **session-mgmt.AC4.4:** Call `registry.execute('delete_session', { session_id: 'test-id' })`. Assert `deleteSession` was called on the store with `'test-id'`. Assert return value confirms deletion. Also test with a non-existent session (mock returns `false`) — assert it throws.

**Verification:**

Run: `bun test src/tools/sessions.test.ts`
Expected: All tests pass

**Commit:** `test(tools): add session management tool tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
