# GH10: Custom Tool Creation + Approval Workflow — Phase 1

**Goal:** Implement `CustomToolManager` — the core data layer for storing, retrieving, approving, and revoking custom tools using the existing document store.

**Architecture:** Custom tools are stored as `customtool:<name>` documents in the SQLite store (same `documents` table used by notes and skills). The manager serializes `CustomTool` objects as JSON content. A SHA-256 hash of `code + JSON.stringify(parameters)` enables auto-revoke on code change.

**Tech Stack:** TypeScript, `node:crypto` (SHA-256), `bun:sqlite` (via existing `Store` interface)

**Scope:** 3 phases from original design (phase 1 of 3)

**Prerequisites:** #14 (Standalone Secrets Management) must be merged. The `SecretManager` interface at `src/secrets/manager.ts` provides `resolve(keys)` used later in Phase 2. #3 (Multi-Tool Architecture) must be merged — it adds `mode: 'sandbox' | 'native' | 'both'` to the tool registry, used in Phase 2 for tool registration.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH10.AC1: Tool persistence
- **GH10.AC1.1:** `saveTool` stores as `customtool:<name>` document with `approved: false`
- **GH10.AC1.2:** `saveTool` on existing tool with changed code auto-revokes (`approved = false`)
- **GH10.AC1.3:** `saveTool` on existing tool with unchanged code preserves approval status

### GH10.AC4: Tool approval
- **GH10.AC4.1:** `approveTool` sets `approved = true`

### GH10.AC7: Approved tool summaries
- **GH10.AC7.1:** `getApprovedToolSummaries()` returns only approved tools

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `CustomTool` type and `CustomToolManager` interface

**Files:**
- Create: `src/tools/custom-tool-manager.ts`

**Implementation:**

Create the new `src/tools/` directory and the manager module. This file follows the `// pattern: Functional Core` convention used throughout the codebase (see `src/agent/tools.ts`, `src/runtime/tool-registry.ts`).

Define the `CustomTool` type and `CustomToolManager` interface. The type uses `readonly` fields consistent with the project's immutable-config convention (see `src/agent/types.ts`).

```typescript
// pattern: Functional Core — custom tool manager type + factory

import { createHash } from 'node:crypto';
import type { Store } from '../store/store.ts';

export type CustomTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly code: string;
  readonly approved: boolean;
  readonly codeHash: string;
  readonly secrets: ReadonlyArray<string>;
};

export type CustomToolManager = {
  listTools(): CustomTool[];
  getTool(name: string): CustomTool | undefined;
  saveTool(tool: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly code: string;
    readonly secrets?: ReadonlyArray<string>;
  }): CustomTool;
  approveTool(name: string): boolean;
  revokeTool(name: string): boolean;
  getApprovedToolSummaries(): Array<{ name: string; description: string }>;
};
```

The `saveTool` input omits `approved` and `codeHash` (computed internally). It returns the saved `CustomTool` so callers can inspect the result (e.g., whether it was auto-revoked).

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors (the file is types + an import only at this point, no implementation yet)

**Commit:** `feat(GH10): add CustomTool type and CustomToolManager interface`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `createCustomToolManager` factory

**Verifies:** GH10.AC1.1, GH10.AC1.2, GH10.AC1.3, GH10.AC4.1, GH10.AC7.1

**Files:**
- Modify: `src/tools/custom-tool-manager.ts` (add factory function below the types)

**Implementation:**

Add the `createCustomToolManager(store: Store)` factory function to the same file. This follows the factory pattern used by `createToolRegistry()` in `src/runtime/tool-registry.ts` and `createSecretManager()` in `src/secrets/manager.ts`.

Key implementation details:

1. **Storage format:** Each custom tool is stored as a document with rkey `customtool:<name>`. The document content is `JSON.stringify(customTool)`. This reuses the existing `documents` table and gets FTS5 indexing for free.

2. **Hash computation:** `createHash('sha256').update(code + JSON.stringify(parameters)).digest('hex').slice(0, 16)` — same truncated-hash pattern used in `src/agent/tools.ts` line 23 (`hashCode` helper), but hashing `code + serialized parameters` together so parameter changes also trigger auto-revoke.

3. **Auto-revoke logic in `saveTool`:**
   - Compute hash of new `code + JSON.stringify(parameters)`
   - If tool already exists (document with `customtool:<name>` exists):
     - If hash matches existing: preserve current `approved` status
     - If hash differs: set `approved = false`
   - If new tool: `approved = false`

4. **`listTools()`:** Query all documents with rkey prefix `customtool:` via `store.docList()` with a high limit, then filter by rkey prefix and deserialize. (The store's `docList` returns documents sorted by rkey, and `customtool:` sorts after `context/` but before `operator`, so pagination with cursor works naturally.)

5. **`getTool(name)`:** `store.docGet('customtool:' + name)`, deserialize if found.

6. **`approveTool(name)` / `revokeTool(name)`:** Load tool, update `approved` field, re-serialize and `docUpsert`. Return `false` if tool not found.

7. **`getApprovedToolSummaries()`:** Call `listTools()`, filter `approved === true`, map to `{ name, description }`.

```typescript
function computeHash(code: string, parameters: Record<string, unknown>): string {
  return createHash('sha256')
    .update(code + JSON.stringify(parameters))
    .digest('hex')
    .slice(0, 16);
}

function rkey(name: string): string {
  return `customtool:${name}`;
}

export function createCustomToolManager(store: Store): CustomToolManager {
  function deserialize(content: string): CustomTool | undefined {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
        return parsed as CustomTool;
      }
    } catch { /* corrupt document — skip */ }
    return undefined;
  }

  function listTools(): CustomTool[] {
    const result = store.docList(500);
    const tools: CustomTool[] = [];
    for (const doc of result.documents) {
      if (!doc.rkey.startsWith('customtool:')) continue;
      const tool = deserialize(doc.content);
      if (tool) tools.push(tool);
    }
    return tools;
  }

  function getTool(name: string): CustomTool | undefined {
    const doc = store.docGet(rkey(name));
    if (!doc) return undefined;
    return deserialize(doc.content);
  }

  function saveTool(input: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly code: string;
    readonly secrets?: ReadonlyArray<string>;
  }): CustomTool {
    const codeHash = computeHash(input.code, input.parameters);
    const existing = getTool(input.name);

    let approved = false;
    if (existing && existing.codeHash === codeHash) {
      approved = existing.approved;
    }

    const tool: CustomTool = {
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      code: input.code,
      approved,
      codeHash,
      secrets: input.secrets ?? [],
    };

    store.docUpsert(rkey(input.name), JSON.stringify(tool));
    return tool;
  }

  function approveTool(name: string): boolean {
    const existing = getTool(name);
    if (!existing) return false;
    const updated: CustomTool = { ...existing, approved: true };
    store.docUpsert(rkey(name), JSON.stringify(updated));
    return true;
  }

  function revokeTool(name: string): boolean {
    const existing = getTool(name);
    if (!existing) return false;
    const updated: CustomTool = { ...existing, approved: false };
    store.docUpsert(rkey(name), JSON.stringify(updated));
    return true;
  }

  function getApprovedToolSummaries(): Array<{ name: string; description: string }> {
    return listTools()
      .filter(t => t.approved)
      .map(t => ({ name: t.name, description: t.description }));
  }

  return { listTools, getTool, saveTool, approveTool, revokeTool, getApprovedToolSummaries };
}
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

**Commit:** `feat(GH10): implement createCustomToolManager factory`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for `CustomToolManager`

**Verifies:** GH10.AC1.1, GH10.AC1.2, GH10.AC1.3, GH10.AC4.1, GH10.AC7.1

**Files:**
- Create: `src/tools/custom-tool-manager.test.ts`

**Testing:**

Use Bun's built-in test runner (`bun test`). There are currently no test files in the codebase, so this establishes the testing pattern. Bun discovers `*.test.ts` files automatically.

Tests use a real SQLite database (in-memory via `":memory:"` or a temp file) through `createStore()` from `src/store/store.ts`. This is an integration test — no mocking the store. The store is cheap to create and the operations are synchronous, so real-database tests are both simpler and more trustworthy than mocks.

Each test case should create a fresh store via `createStore(':memory:')` in a `beforeEach` or at the top of each `test()` block, then create a `CustomToolManager` from it.

Tests must verify these specific AC cases:

- **GH10.AC1.1 — New tool stored as unapproved:**
  Call `saveTool({ name: 'test-tool', description: 'A test', parameters: {}, code: 'output("hi")' })`.
  Assert returned tool has `approved === false`.
  Assert `getTool('test-tool')` returns the tool with `approved === false`.

- **GH10.AC1.2 — Changed code auto-revokes:**
  Save a tool, then `approveTool('test-tool')` to set `approved = true`.
  Save same tool name again with different `code`.
  Assert returned tool has `approved === false`.
  Assert `getTool('test-tool')` returns `approved === false`.

- **GH10.AC1.3 — Unchanged code preserves approval:**
  Save a tool, approve it.
  Save again with identical `code` and `parameters` but different `description`.
  Assert `approved` is still `true`.
  (Description changes don't affect the hash — only `code + parameters` matter.)

- **GH10.AC4.1 — approveTool sets approved:**
  Save a tool (starts unapproved).
  Call `approveTool('test-tool')`.
  Assert `getTool('test-tool')?.approved === true`.
  Assert `approveTool('nonexistent')` returns `false`.

- **GH10.AC7.1 — getApprovedToolSummaries returns only approved:**
  Save two tools. Approve only one.
  Call `getApprovedToolSummaries()`.
  Assert result contains only the approved tool's `{ name, description }`.

Additional edge case tests:
- `revokeTool` sets `approved = false` on an approved tool
- `revokeTool` on nonexistent tool returns `false`
- `listTools` returns all custom tools (both approved and unapproved)
- `getTool` for nonexistent name returns `undefined`
- Changing `parameters` but not `code` also triggers auto-revoke (hash includes both)

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && bun test src/tools/custom-tool-manager.test.ts`
Expected: All tests pass

**Commit:** `test(GH10): add CustomToolManager tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
