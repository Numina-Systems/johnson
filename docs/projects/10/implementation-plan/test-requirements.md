# GH10: Custom Tool Creation + Approval Workflow — Test Requirements

This document maps each acceptance criterion from the design to specific automated tests. All criteria are covered by automated tests; none require human verification.

## Test Infrastructure

- **Runner:** `bun test` (Bun's built-in test runner, discovers `*.test.ts` automatically)
- **Database:** Real SQLite via `createStore(':memory:')` — no mocking the store
- **Runtime:** Mock `CodeRuntime` that records call arguments and returns configurable results
- **Secrets:** Mock `SecretManager` with hardcoded test values

## Acceptance Criteria to Test Mapping

### GH10.AC1: `saveTool` stores as `customtool:<name>` document with `approved: false`

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC1.1 | Unit | `src/tools/custom-tool-manager.test.ts` | New tool via `saveTool()` returns `approved === false`; `getTool()` confirms persistence |

### GH10.AC2: `saveTool` on existing tool with changed code auto-revokes

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC1.2 | Unit | `src/tools/custom-tool-manager.test.ts` | Save tool, approve, save with different code; assert `approved === false` |

### GH10.AC3: `saveTool` on existing tool with unchanged code preserves approval

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC1.3 | Unit | `src/tools/custom-tool-manager.test.ts` | Save tool, approve, save again with same code+params but different description; assert `approved` stays `true` |

### GH10.AC4: `approveTool` sets `approved = true`

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC4.1 | Unit | `src/tools/custom-tool-manager.test.ts` | Save tool, call `approveTool()`, assert `getTool()` returns `approved === true`; assert `approveTool('nonexistent')` returns `false` |

### GH10.AC5: `call_custom_tool` on unapproved tool returns clear error

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC5.1 | Unit | `src/tools/custom-tools.test.ts` | Create tool (unapproved), call via `registry.execute('call_custom_tool', ...)`, assert throws with message containing "not approved" |
| GH10.AC12.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Same scenario through `createAgentTools` registry |

### GH10.AC6: `call_custom_tool` on approved tool executes via Deno sandbox with secrets

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC6.1 | Unit | `src/tools/custom-tools.test.ts` | Create tool with secrets, approve, call; assert mock runtime received code with `__params` prefix, env with resolved secrets, and result is mock output |
| GH10.AC11.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Same scenario through full `AgentDependencies` + `createAgentTools` |

### GH10.AC7: `getApprovedToolSummaries()` returns only approved tools

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC7.1 | Unit | `src/tools/custom-tool-manager.test.ts` | Save two tools, approve one; assert `getApprovedToolSummaries()` returns only the approved tool's `{ name, description }` |

### GH10.AC8: All three agent-facing tools registered as `mode: 'sandbox'`

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC8.1 | Unit | `src/tools/custom-tools.test.ts` | After `registerCustomTools()`, verify all three tool names appear in `registry.list()` |
| GH10.AC8.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Verify tools appear in `generateTypeScriptStubs()` output (sandbox-mode tools produce stubs) |

### GH10.AC9: Test — create tool, verify stored with approved=false

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC9.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Call `create_custom_tool` through registry, assert response says "Pending approval", assert `list_custom_tools` shows "pending" |

### GH10.AC10: Test — approve, change code, verify auto-revoked

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC10.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Create, approve via manager, create again with different code; assert response says "revoked" |

### GH10.AC11: Test — call approved tool, verify Deno execution with correct env vars

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC11.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Create with secrets, approve, call; assert mock runtime received correct code prefix and env vars |

### GH10.AC12: Test — call unapproved tool, verify error

| AC | Test Type | Test File | Description |
|----|-----------|-----------|-------------|
| GH10.AC12.1 | Integration | `src/tools/custom-tools-integration.test.ts` | Create (unapproved), call; assert throws "not approved" |

## Additional Edge Case Tests (not mapped to design ACs)

| Test File | Description |
|-----------|-------------|
| `src/tools/custom-tool-manager.test.ts` | `revokeTool` sets `approved = false` on approved tool |
| `src/tools/custom-tool-manager.test.ts` | `revokeTool` on nonexistent tool returns `false` |
| `src/tools/custom-tool-manager.test.ts` | `listTools` returns all custom tools regardless of status |
| `src/tools/custom-tool-manager.test.ts` | `getTool` for nonexistent name returns `undefined` |
| `src/tools/custom-tool-manager.test.ts` | Changing parameters (not code) also triggers auto-revoke |
| `src/tools/custom-tools.test.ts` | `create_custom_tool` rejects invalid tool names |
| `src/tools/custom-tools.test.ts` | `create_custom_tool` returns correct status for each scenario |
| `src/tools/custom-tools.test.ts` | `list_custom_tools` with no tools returns `"(no custom tools)"` |
| `src/tools/custom-tools.test.ts` | `call_custom_tool` with nonexistent tool throws "not found" |
| `src/tools/custom-tools.test.ts` | `call_custom_tool` when runtime fails throws the error |
| `src/tools/custom-tools.test.ts` | `call_custom_tool` does not pass `onToolCall` to runtime |

## Test Execution

```bash
# Run all tests
bun test

# Run phase 1 tests only
bun test src/tools/custom-tool-manager.test.ts

# Run phase 2 tests only
bun test src/tools/custom-tools.test.ts

# Run phase 3 integration tests only
bun test src/tools/custom-tools-integration.test.ts
```
