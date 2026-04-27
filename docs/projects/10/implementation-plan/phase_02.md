# GH10: Custom Tool Creation + Approval Workflow — Phase 2

**Goal:** Implement the three agent-facing sandbox tools (`create_custom_tool`, `list_custom_tools`, `call_custom_tool`) that let the agent create, discover, and execute custom tools at runtime.

**Architecture:** All three tools are registered as `mode: 'sandbox'` in the tool registry, meaning they are callable only through `execute_code` via `tools.create_custom_tool(...)` etc. `call_custom_tool` executes approved tool code in a fresh Deno sandbox with declared secrets injected as environment variables — the same execution path used by `run_skill` in `src/agent/tools.ts`.

**Tech Stack:** TypeScript, existing `ToolRegistry` from `src/runtime/tool-registry.ts`, `CodeRuntime` from `src/runtime/types.ts`, `SecretManager` from `src/secrets/manager.ts`

**Scope:** 3 phases from original design (phase 2 of 3)

**Prerequisites:** Phase 1 completed (CustomToolManager exists at `src/tools/custom-tool-manager.ts`). #3 (Multi-Tool Architecture) merged — `register()` in `src/runtime/tool-registry.ts` accepts a `mode` parameter. #14 (Secrets) merged — `SecretManager.resolve()` available on `deps.secrets`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH10.AC5: call_custom_tool on unapproved tool
- **GH10.AC5.1:** `call_custom_tool` on unapproved tool returns clear error

### GH10.AC6: call_custom_tool on approved tool
- **GH10.AC6.1:** `call_custom_tool` on approved tool executes via Deno sandbox with secrets injected

### GH10.AC8: Tool registration mode
- **GH10.AC8.1:** All three agent-facing tools registered as `mode: 'sandbox'`

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create barrel export for custom tool manager

**Files:**
- Create: `src/tools/index.ts`

**Implementation:**

Create the barrel export following the pattern used by `src/secrets/index.ts`:

```typescript
export type { CustomTool, CustomToolManager } from './custom-tool-manager.ts';
export { createCustomToolManager } from './custom-tool-manager.ts';
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

**Commit:** `feat(GH10): add barrel export for custom tools module`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement agent-facing custom tool definitions

**Verifies:** GH10.AC5.1, GH10.AC6.1, GH10.AC8.1

**Files:**
- Create: `src/tools/custom-tools.ts`

**Implementation:**

This file exports a single function that registers the three custom tool operations into the agent's `ToolRegistry`. It follows the same pattern as `createAgentTools()` in `src/agent/tools.ts` — a function that takes dependencies and a registry, then calls `registry.register()` for each tool.

The function signature:

```typescript
import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { CustomToolManager } from './custom-tool-manager.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

type CustomToolDeps = {
  readonly customTools: CustomToolManager;
  readonly runtime: CodeRuntime;
  readonly secrets?: SecretManager;
};

export function registerCustomTools(
  registry: ToolRegistry,
  deps: Readonly<CustomToolDeps>,
): void {
  // ... register three tools
}
```

**`create_custom_tool`** — registered as `mode: 'sandbox'`:

Parameters (JSON Schema):
- `name`: string, required — tool name (alphanumeric + hyphens)
- `description`: string, required — what the tool does
- `parameters`: object, required — JSON Schema for the tool's parameters
- `code`: string, required — TypeScript code to execute
- `secrets`: array of strings, optional — secret names to inject as env vars

Handler:
1. Validate `name` matches `/^[a-z][a-z0-9-]*$/` (lowercase, starts with letter, hyphens allowed). Throw if invalid — tool names become part of rkeys and must be safe.
2. Call `deps.customTools.saveTool({ name, description, parameters, code, secrets })`.
3. Return a status message:
   - If `result.approved === false` and tool existed before with different hash: `"Tool '${name}' updated. Code changed — approval revoked, needs re-approval."`
   - If `result.approved === false` (new tool): `"Tool '${name}' created. Pending approval — use /review in the TUI to approve."`
   - If `result.approved === true` (unchanged code, preserved approval): `"Tool '${name}' updated (code unchanged, still approved)."`

To distinguish "new" from "updated + revoked", check whether `deps.customTools.getTool(name)` exists *before* calling `saveTool`.

**`list_custom_tools`** — registered as `mode: 'sandbox'`:

No parameters.

Handler:
1. Call `deps.customTools.listTools()`.
2. If empty, return `"(no custom tools)"`.
3. Format each tool as: `"- **${name}** ${approved ? '(approved)' : '(pending approval)'} — ${description}"`.
4. Return joined with newlines.

**`call_custom_tool`** — registered as `mode: 'sandbox'`:

Parameters (JSON Schema):
- `name`: string, required — tool name to call
- `params`: object, optional — parameters matching the tool's schema

Handler:
1. Look up tool via `deps.customTools.getTool(name)`.
2. If not found: throw `Error('Custom tool not found: ${name}')`.
3. If not approved: throw `Error('Custom tool "${name}" is not approved. Use /review in the TUI to approve it.')`.
4. Resolve secrets: `const env = deps.secrets?.resolve(tool.secrets) ?? {}`.
5. Build code: prepend `const __params = ${JSON.stringify(params ?? {})};\n` to `tool.code`.
6. Execute: `const result = await deps.runtime.execute(code, Object.keys(env).length > 0 ? env : undefined)`.
   - Note: no `onToolCall` callback — custom tool code is self-contained, it does NOT get access to the `tools.*` namespace. This prevents privilege escalation (a custom tool calling `doc_upsert` to modify itself).
7. If `!result.success`: throw with `result.error` + `result.output`.
8. Return `result.output || '(no output)'`.

```typescript
// pattern: Functional Core — custom tool agent-facing tool definitions

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { CustomToolManager } from './custom-tool-manager.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

type CustomToolDeps = {
  readonly customTools: CustomToolManager;
  readonly runtime: CodeRuntime;
  readonly secrets?: SecretManager;
};

const TOOL_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function registerCustomTools(
  registry: ToolRegistry,
  deps: Readonly<CustomToolDeps>,
): void {

  // ── create_custom_tool ──────────────────────────────────────────────
  registry.register(
    'create_custom_tool',
    {
      name: 'create_custom_tool',
      description:
        'Create or update a custom tool. Custom tools are TypeScript code that runs in the Deno sandbox when called via call_custom_tool. New tools start unapproved and must be approved via /review before they can be executed. Changing code or parameters auto-revokes approval.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name (lowercase, alphanumeric + hyphens, starts with letter)' },
          description: { type: 'string', description: 'What the tool does' },
          parameters: { type: 'object', description: 'JSON Schema for the tool parameters. Available as __params in the tool code.' },
          code: { type: 'string', description: 'TypeScript code to execute. Has access to __params (the caller-provided params) and output()/debug() helpers.' },
          secrets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Secret names to inject as env vars when running (e.g. ["OPENAI_API_KEY"])',
          },
        },
        required: ['name', 'description', 'parameters', 'code'],
      },
    },
    async (input) => {
      const name = input['name'];
      const description = input['description'];
      const parameters = input['parameters'];
      const code = input['code'];
      const secrets = input['secrets'];

      if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
        throw new Error(`Invalid tool name: "${name}". Must match /^[a-z][a-z0-9-]*$/.`);
      }
      if (typeof description !== 'string' || !description.trim()) {
        throw new Error('Missing required param: description');
      }
      if (typeof parameters !== 'object' || parameters === null) {
        throw new Error('Missing required param: parameters (must be a JSON Schema object)');
      }
      if (typeof code !== 'string' || !code.trim()) {
        throw new Error('Missing required param: code');
      }

      const secretsList: string[] = Array.isArray(secrets)
        ? secrets.filter((s): s is string => typeof s === 'string')
        : [];

      const existed = deps.customTools.getTool(name);
      const result = deps.customTools.saveTool({
        name,
        description,
        parameters: parameters as Record<string, unknown>,
        code,
        secrets: secretsList,
      });

      if (result.approved) {
        return `Tool "${name}" updated (code unchanged, still approved).`;
      }
      if (existed) {
        return `Tool "${name}" updated. Code changed — approval revoked, needs re-approval via /review.`;
      }
      return `Tool "${name}" created. Pending approval — use /review in the TUI to approve.`;
    },
    'sandbox',
  );

  // ── list_custom_tools ───────────────────────────────────────────────
  registry.register(
    'list_custom_tools',
    {
      name: 'list_custom_tools',
      description: 'List all custom tools with their approval status.',
      input_schema: { type: 'object', properties: {} },
    },
    async () => {
      const tools = deps.customTools.listTools();
      if (tools.length === 0) return '(no custom tools)';
      return tools
        .map(t => `- **${t.name}** ${t.approved ? '(approved)' : '(pending approval)'} — ${t.description}`)
        .join('\n');
    },
    'sandbox',
  );

  // ── call_custom_tool ────────────────────────────────────────────────
  registry.register(
    'call_custom_tool',
    {
      name: 'call_custom_tool',
      description:
        'Execute an approved custom tool by name. The tool runs in a Deno sandbox with its declared secrets injected as environment variables. Pass params matching the tool\'s JSON Schema — available as __params in the tool code.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the custom tool to call' },
          params: { type: 'object', description: 'Parameters to pass (available as __params in tool code)' },
        },
        required: ['name'],
      },
    },
    async (input) => {
      const name = input['name'];
      if (typeof name !== 'string') throw new Error('Missing required param: name');

      const params = input['params'] ?? {};

      const tool = deps.customTools.getTool(name);
      if (!tool) throw new Error(`Custom tool not found: "${name}"`);
      if (!tool.approved) {
        throw new Error(`Custom tool "${name}" is not approved. Use /review in the TUI to approve it.`);
      }

      // Resolve declared secrets
      const env = deps.secrets ? deps.secrets.resolve(tool.secrets) : {};

      // Build code with params injection
      const fullCode = `const __params = ${JSON.stringify(params)};\n${tool.code}`;

      // Execute in sandbox WITHOUT onToolCall — custom tools don't get tools.* access
      const result = await deps.runtime.execute(
        fullCode,
        Object.keys(env).length > 0 ? env : undefined,
      );

      if (!result.success) {
        throw new Error(`${result.error ?? 'unknown error'}\n${result.output}`);
      }

      return result.output || '(no output)';
    },
    'sandbox',
  );
}
```

Note on the `register()` call: After #3 is merged, `register()` accepts an optional fourth argument `mode` (defaulting to `'sandbox'`). The explicit `'sandbox'` is shown for clarity. If the `register` signature on your branch doesn't have the mode parameter yet, the calls still work because `'sandbox'` is the default.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && npx tsc --noEmit`
Expected: Type-checks without errors

**Commit:** `feat(GH10): implement agent-facing custom tool definitions`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for agent-facing custom tools

**Verifies:** GH10.AC5.1, GH10.AC6.1, GH10.AC8.1

**Files:**
- Create: `src/tools/custom-tools.test.ts`

**Testing:**

These tests verify the handler logic of `create_custom_tool`, `list_custom_tools`, and `call_custom_tool`. They require:

1. A real `Store` (via `createStore(':memory:')` — same approach as Phase 1 tests)
2. A real `CustomToolManager` (via `createCustomToolManager(store)`)
3. A mock `CodeRuntime` that records calls and returns configurable results
4. An optional mock `SecretManager` for secret resolution tests

The mock runtime should implement the `CodeRuntime` interface:
```typescript
const mockRuntime: CodeRuntime = {
  execute: async (code, env) => {
    // Store call args for assertions
    lastExecuteCall = { code, env };
    return { success: true, output: 'mock output', error: null, duration_ms: 0 };
  },
};
```

For secret resolution, create a minimal `SecretManager` mock:
```typescript
const mockSecrets: SecretManager = {
  listKeys: () => ['API_KEY', 'OTHER_KEY'],
  get: (k) => ({ API_KEY: 'secret-value' }[k]),
  set: () => {},
  remove: () => {},
  resolve: (keys) => {
    const env: Record<string, string> = {};
    for (const k of keys) {
      if (k === 'API_KEY') env[k] = 'secret-value';
    }
    return env;
  },
};
```

Register the tools into a fresh `ToolRegistry` via `registerCustomTools(registry, deps)`, then call handlers through `registry.execute(toolName, params)`.

Tests must verify:

- **GH10.AC5.1 — call unapproved tool returns error:**
  Create a tool (starts unapproved). Call `registry.execute('call_custom_tool', { name: 'test-tool' })`.
  Assert it throws with message containing `"not approved"`.

- **GH10.AC6.1 — call approved tool executes via Deno sandbox with secrets:**
  Create a tool with `secrets: ['API_KEY']`. Approve it. Call `registry.execute('call_custom_tool', { name: 'test-tool', params: { query: 'hello' } })`.
  Assert `mockRuntime.execute` was called.
  Assert the `code` argument starts with `const __params = {"query":"hello"};`.
  Assert the `env` argument contains `{ API_KEY: 'secret-value' }`.
  Assert the result is `'mock output'`.

- **GH10.AC8.1 — tools registered as sandbox mode:**
  After calling `registerCustomTools`, inspect the registry via `registry.list()`.
  Assert all three tools (`create_custom_tool`, `list_custom_tools`, `call_custom_tool`) are present.
  (Mode verification depends on #3's registry exposing mode — if not available yet, verify the tools are registered and produce TypeScript stubs via `generateTypeScriptStubs()`.)

Additional test cases:
- `create_custom_tool` with invalid name (e.g., `"123-bad"`, `"UPPER"`) throws validation error
- `create_custom_tool` returns correct status messages for new, updated+revoked, and updated+unchanged scenarios
- `list_custom_tools` with no tools returns `"(no custom tools)"`
- `list_custom_tools` shows approval status correctly
- `call_custom_tool` with nonexistent tool name throws `"not found"` error
- `call_custom_tool` when runtime returns `success: false` throws the error
- `call_custom_tool` does NOT pass `onToolCall` to `runtime.execute` (verify the mock only receives `code` and `env` arguments, not a third callback)

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH10 && bun test src/tools/custom-tools.test.ts`
Expected: All tests pass

**Commit:** `test(GH10): add agent-facing custom tool tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
