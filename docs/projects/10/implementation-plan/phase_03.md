# GH10: Custom Tool Creation + Approval Workflow — Phase 3

**Goal:** Wire `CustomToolManager` into the dependency graph and register the custom tool operations in the agent's tool registry so they are available at runtime. Add system prompt integration for discoverability.

**Architecture:** `CustomToolManager` is created once in `src/index.ts` (the imperative shell) and passed through `AgentDependencies` to the agent. The `createAgentTools()` function in `src/agent/tools.ts` calls `registerCustomTools()` to add the three custom tool operations to the registry. The system prompt lists approved custom tools for model discoverability.

**Tech Stack:** TypeScript, existing dependency injection pattern via `AgentDependencies`

**Scope:** 3 phases from original design (phase 3 of 3)

**Prerequisites:** Phase 1 and Phase 2 completed. `CustomToolManager` exists at `src/tools/custom-tool-manager.ts`. `registerCustomTools()` exists at `src/tools/custom-tools.ts`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH10.AC8: Tool registration mode (wiring verification)
- **GH10.AC8.1:** All three agent-facing tools registered as `mode: 'sandbox'` (verified via integration)

### GH10.AC9-12: End-to-end integration tests
- **GH10.AC9.1:** Test: create tool then verify stored with approved=false
- **GH10.AC10.1:** Test: approve then change code then verify auto-revoked
- **GH10.AC11.1:** Test: call approved tool then verify Deno execution with correct env vars
- **GH10.AC12.1:** Test: call unapproved tool then verify error

---

<!-- START_TASK_1 -->
### Task 1: Add `customTools` to `AgentDependencies`

**Files:**
- Modify: `src/agent/types.ts`

**Implementation:**

Add the optional `customTools` field to `AgentDependencies`. This follows the pattern of other optional deps like `embedding`, `vectorStore`, `scheduler`, and `secrets`.

At the top of the file, add the import:
```typescript
import type { CustomToolManager } from '../tools/custom-tool-manager.ts';
```

Add to the `AgentDependencies` type (after `secrets?: SecretManager`):
```typescript
readonly customTools?: CustomToolManager;
```

The field is optional because the agent can function without custom tools — same rationale as `embedding?` and `scheduler?`.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors (existing code unaffected — field is optional)

**Commit:** `feat(GH10): add customTools to AgentDependencies`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register custom tools in `createAgentTools()`

**Verifies:** GH10.AC8.1

**Files:**
- Modify: `src/agent/tools.ts`

**Implementation:**

At the end of `createAgentTools()`, conditionally register the custom tools if `deps.customTools` is available. This goes just before the `return registry;` statement (currently at line 327).

Add import at the top of the file (after existing imports):
```typescript
import { registerCustomTools } from '../tools/custom-tools.ts';
```

Add before `return registry;`:
```typescript
  // ── Custom tools (optional) ──────────────────────────────────────────
  if (deps.customTools) {
    registerCustomTools(registry, {
      customTools: deps.customTools,
      runtime: deps.runtime,
      secrets: deps.secrets,
    });
  }

  return registry;
```

This wires the `CustomToolManager`, `CodeRuntime`, and `SecretManager` from the agent's existing deps into the custom tool handlers. When custom tools are not configured (no `customTools` on deps), the three sandbox tools simply don't appear in the registry.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

**Commit:** `feat(GH10): register custom tools in agent tool registry`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add custom tool summaries to system prompt

**Files:**
- Modify: `src/agent/agent.ts` (in the `_chatImpl` method, after skill names section around lines 99-106)

**Implementation:**

**IMPORTANT — alignment with GH12 (Dynamic System Prompt Provider):** GH12 refactors the system prompt building in `_chatImpl`. If GH12 is merged first (it's in Wave 1, same as #10's dependency #3), the inline `buildSystemPrompt()` call is now inside an `else` branch (the fallback path when no `systemPromptProvider` is set). The main path calls `deps.systemPromptProvider(toolDocs)`.

Therefore, the custom tool summaries should be appended to the system prompt AFTER the provider/fallback decision, not inside the fallback path. The correct location is after the `systemPrompt` variable is assigned (regardless of which path set it).

Find the `systemPrompt` variable in `_chatImpl` — after GH12, it's set either by the provider or by the inline fallback. After that assignment, append custom tool listings:

```typescript
    // Append custom tool listings for discoverability
    if (deps.customTools) {
      const summaries = deps.customTools.getApprovedToolSummaries();
      if (summaries.length > 0) {
        const listing = summaries
          .map(s => `- **${s.name}** — ${s.description}`)
          .join('\n');
        systemPrompt += `\n\n## Custom Tools (call via tools.call_custom_tool)\n\n${listing}`;
      }
    }
```

This works regardless of whether GH12's `systemPromptProvider` path or the inline fallback path was taken, because both paths produce a `systemPrompt` string. The variable is `let` (GH12 changes it from `const` to `let` for the caching logic), so appending with `+=` is valid.

If GH12 is NOT merged yet (the inline `buildSystemPrompt` call is still there), the same code works — just place it after the `const systemPrompt = buildSystemPrompt(...)` line and change `const` to `let`.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

**Commit:** `feat(GH10): add custom tool summaries to system prompt`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire `CustomToolManager` in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Implementation:**

Create the `CustomToolManager` instance in `main()` and pass it to agent dependencies. This follows the same wiring pattern as `secrets`, `store`, and `scheduler`.

Add import near the top (after the `createSecretManager` import on line 17):
```typescript
import { createCustomToolManager } from './tools/index.ts';
```

After the `secrets` creation (around line 47-48), create the custom tool manager:
```typescript
  // Custom tool manager — uses documents store for persistence
  const customTools = createCustomToolManager(store);
```

Add `customTools` to the `agentDeps` object (around line 77-94). Add it after the `secrets` field:
```typescript
    secrets,
    customTools,
```

Also pass `customTools` to the TUI agent creation on line 113:
```typescript
    const tuiAgent = createAgent({ ...agentDeps, scheduler, customTools });
```

Wait — `customTools` is already on `agentDeps`, so the spread handles it. The `{ ...agentDeps, scheduler }` spread already includes `customTools` because it's part of `agentDeps`. No change needed on line 113.

Verify: the `startTUI` call on line 114 may need `customTools` passed if the TUI needs it for the review/tools screen. However, that's #13's scope (Multi-Screen TUI). For now, the TUI doesn't use `customTools` directly — it goes through the agent's tool registry.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && bun run build`
Expected: Builds without errors

**Commit:** `feat(GH10): wire CustomToolManager into dependency graph`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: End-to-end integration tests

**Verifies:** GH10.AC9.1, GH10.AC10.1, GH10.AC11.1, GH10.AC12.1

**Files:**
- Create: `src/tools/custom-tools-integration.test.ts`

**Testing:**

These integration tests exercise the full flow through the tool registry, verifying that `createAgentTools` + `registerCustomTools` work together correctly. They use:

1. A real `Store` (`:memory:`)
2. A real `CustomToolManager`
3. A mock `CodeRuntime`
4. A mock `SecretManager`
5. A mock `ModelProvider` (to satisfy `AgentDependencies`)
6. A real `ToolRegistry` created via `createAgentTools(deps, context)`

The test creates `AgentDependencies` with all required fields mocked/real, calls `createAgentTools(deps, {})`, then invokes tools through the registry.

Minimal mock deps:
```typescript
const store = createStore(':memory:');
const customTools = createCustomToolManager(store);

let lastRuntimeCall: { code: string; env?: Record<string, string> } | null = null;
const mockRuntime: CodeRuntime = {
  execute: async (code, env) => {
    lastRuntimeCall = { code, env };
    return { success: true, output: 'tool output', error: null, duration_ms: 10 };
  },
};

const mockSecrets: SecretManager = {
  listKeys: () => ['MY_SECRET'],
  get: (k) => k === 'MY_SECRET' ? 'secret-val' : undefined,
  set: () => {},
  remove: () => {},
  resolve: (keys) => {
    const env: Record<string, string> = {};
    for (const k of keys) if (k === 'MY_SECRET') env[k] = 'secret-val';
    return env;
  },
};
```

For `AgentDependencies`, provide stub values for fields the custom tools don't use:
```typescript
const deps: AgentDependencies = {
  model: { complete: async () => { throw new Error('not needed'); } },
  runtime: mockRuntime,
  config: {
    model: 'test', maxTokens: 1000, maxToolRounds: 5,
    contextBudget: 100000, contextLimit: 0.8,
    modelTimeout: 30000, timezone: 'UTC',
  },
  personaPath: '/dev/null',
  store,
  secrets: mockSecrets,
  customTools,
};
```

Tests must verify these end-to-end scenarios:

- **GH10.AC9.1 — Create tool, verify stored unapproved:**
  Call `registry.execute('create_custom_tool', { name: 'my-tool', description: 'test', parameters: {}, code: 'output("hi")' })`.
  Assert result string contains `"created"` and `"Pending approval"`.
  Call `registry.execute('list_custom_tools', {})`.
  Assert result contains `"my-tool"` and `"pending approval"`.

- **GH10.AC10.1 — Approve, change code, verify auto-revoked:**
  Create tool, approve it via `customTools.approveTool('my-tool')`.
  Create same tool again with different code.
  Assert result string contains `"revoked"`.
  Call `registry.execute('list_custom_tools', {})`.
  Assert result contains `"pending approval"`.

- **GH10.AC11.1 — Call approved tool with secrets:**
  Create tool with `secrets: ['MY_SECRET']`, approve it.
  Call `registry.execute('call_custom_tool', { name: 'my-tool', params: { x: 1 } })`.
  Assert `lastRuntimeCall.code` starts with `const __params = {"x":1};`.
  Assert `lastRuntimeCall.env` contains `{ MY_SECRET: 'secret-val' }`.
  Assert result is `'tool output'`.

- **GH10.AC12.1 — Call unapproved tool returns error:**
  Create tool (unapproved).
  Call `registry.execute('call_custom_tool', { name: 'my-tool' })`.
  Assert it throws with message containing `"not approved"`.

Additional integration tests:
- Custom tools appear in `registry.generateTypeScriptStubs()` (since they're sandbox mode)
- Custom tools appear in `registry.generateToolDocumentation()`
- `call_custom_tool` for nonexistent tool throws meaningful error

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && bun test src/tools/custom-tools-integration.test.ts`
Expected: All tests pass

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && bun test`
Expected: All tests pass (Phase 1 + Phase 2 + Phase 3 tests)

**Commit:** `test(GH10): add end-to-end integration tests for custom tools`
<!-- END_TASK_5 -->
