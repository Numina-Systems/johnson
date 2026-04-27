# #10 — Custom Tool Creation + Approval Workflow

**Issue:** https://github.com/Numina-Systems/johnson/issues/10
**Wave:** 3 (depends on: #3 registry mode, #14 secrets)

## Design

### Sandbox-Only Dispatch

Custom tools are **not** exposed as native API-level tool definitions. They're called through `tools.call_custom_tool({ name, params })` inside execute_code.

**Rationale:**
1. Dynamic tool definitions invalidate prompt cache — every create/approve/revoke changes the tool list sent to the API, busting Anthropic's cached prefix
2. Composition — "fetch calendar → parse events → notify" is one sandbox call, not three round-trips
3. Approval surface stays simple — no trust distinction between how the model calls custom vs built-in tools
4. Consistent with single-dispatch philosophy — everything through execute_code

The system prompt lists approved custom tools by name + description for discoverability. The call path is: `execute_code → tools.call_custom_tool(...) → registry dispatch → Deno execution with secret injection`.

### CustomToolManager (`src/tools/custom-tool-manager.ts`)

```typescript
type CustomTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;  // JSON Schema
  readonly code: string;                          // TypeScript
  readonly approved: boolean;
  readonly codeHash: string;
  readonly secrets: string[];                     // secret names to inject as env vars
};

type CustomToolManager = {
  listTools(): CustomTool[];
  getTool(name: string): CustomTool | undefined;
  saveTool(tool: Omit<CustomTool, 'approved' | 'codeHash'>): void;
  approveTool(name: string): void;
  revokeTool(name: string): void;
  getApprovedToolSummaries(): Array<{ name: string; description: string }>;
};
```

**Storage:** `customtool:<name>` documents in the store. Content is JSON-serialized `CustomTool`.

**Auto-revoke:** On `saveTool`, compute hash of `code + JSON.stringify(parameters)`. If the tool already exists and the hash differs, set `approved = false`. New tools start with `approved = false`.

**`getApprovedToolSummaries()`** — returns `[{ name, description }]` for approved tools only. Used by the system prompt provider (#12) to list available custom tools in the prompt.

### Agent-Facing Tools (`src/tools/custom-tools.ts`)

Three tools, all `mode: 'sandbox'`:

**`create_custom_tool`**
- Params: `name` (string), `description` (string), `parameters` (JSON Schema object), `code` (string, TypeScript), `secrets` (optional string array)
- Calls `manager.saveTool(...)`
- Returns status message (created + pending approval, or updated + auto-revoked)

**`list_custom_tools`**
- No params
- Returns all tools with name, description, approved status

**`call_custom_tool`**
- Params: `name` (string), `params` (object matching the tool's JSON Schema)
- Guards: tool must exist, must be approved
- Execution:
  1. Look up tool via `manager.getTool(name)`
  2. Verify approved
  3. Resolve declared secrets via `deps.secrets.resolve(tool.secrets)`
  4. Build TypeScript code: inject params as `const __params = {...};\n` prefix + tool code
  5. Execute via `deps.runtime.execute(code, env)` where `env` is the resolved secrets
  6. Return result

### System Prompt Integration

The system prompt provider (#12) calls `customToolManager.getApprovedToolSummaries()` and includes them in the prompt:

```
## Custom Tools (call via tools.call_custom_tool)

- **my-calendar-tool** — Fetches Google Calendar events for today
- **sentiment-analyzer** — Analyzes sentiment of input text
```

This gives the model discoverability without polluting the API tool list.

### Wiring

`CustomToolManager` created in `src/index.ts`, passed into `AgentDependencies`:

```typescript
type AgentDependencies = {
  // ... existing fields
  customTools?: CustomToolManager;
};
```

### TUI Integration

Deferred to #13 (multi-screen TUI). The tools screen will call `customTools.listTools()`, `approveTool()`, `revokeTool()`.

## Files Touched

- `src/tools/custom-tool-manager.ts` — new file, manager type + factory
- `src/tools/custom-tools.ts` — new file, three sandbox-mode tool definitions
- `src/agent/tools.ts` — register custom tool agent-facing tools
- `src/agent/types.ts` — add `customTools?: CustomToolManager` to `AgentDependencies`
- `src/index.ts` — create and wire CustomToolManager

## Acceptance Criteria

1. `saveTool` stores as `customtool:<name>` document with `approved: false`
2. `saveTool` on existing tool with changed code → auto-revokes (`approved = false`)
3. `saveTool` on existing tool with unchanged code → preserves approval status
4. `approveTool` sets `approved = true`
5. `call_custom_tool` on unapproved tool → clear error
6. `call_custom_tool` on approved tool → executes via Deno sandbox with secrets injected
7. `getApprovedToolSummaries()` returns only approved tools
8. All three agent-facing tools registered as `mode: 'sandbox'`
9. Test: create tool → verify stored with approved=false
10. Test: approve → change code → verify auto-revoked
11. Test: call approved tool → verify Deno execution with correct env vars
12. Test: call unapproved tool → verify error
