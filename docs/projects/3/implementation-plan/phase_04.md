# GH03: Multi-Tool Architecture — Phase 4: Integration Tests

**Goal:** Verify the full multi-tool dispatch pipeline works end-to-end: native tools dispatch through the registry, execute_code still dispatches through the Deno sandbox, and the two paths coexist correctly.

**Architecture:** Integration tests use mock model providers and mock runtimes to simulate the agent loop without real LLM calls or Deno subprocesses. Tests verify dispatch routing, result formatting, and error handling for both native and sandbox tool paths.

**Tech Stack:** TypeScript, Bun test runner

**Scope:** 4 phases from original design (phases 1-4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH03.AC5: Agent loop dispatches native tools directly
- **GH03.AC5.1 Success:** Agent loop dispatches native tools directly through registry

### GH03.AC6: Agent loop still dispatches execute_code through Deno sandbox
- **GH03.AC6.1 Success:** Agent loop still dispatches `execute_code` through Deno sandbox

### GH03.AC10: Mock model returns native tool_use, registry.execute called directly
- **GH03.AC10.1 Success:** Mock model returns native tool_use → verify registry.execute called directly

### GH03.AC11: Mock model returns execute_code, Deno sandbox path unchanged
- **GH03.AC11.1 Success:** Mock model returns `execute_code` → verify Deno sandbox path unchanged

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create test helpers for agent loop testing

**Files:**
- Create: `src/agent/agent.test.ts`

**Implementation:**

The agent loop (`createAgent`) requires `AgentDependencies`. For testing, build mock implementations of each dependency.

Key mocks needed:

1. **Mock ModelProvider** — Returns predefined responses. Must support multiple rounds (first call returns tool_use, second call returns end_turn with text). The mock should be configurable with a sequence of responses.

2. **Mock CodeRuntime** — Records calls and returns predefined `ExecutionResult`. Used to verify `execute_code` dispatch goes through the sandbox.

3. **Mock Store** — Minimal implementation that satisfies the Store interface. Needs `docGet()` (return null for `self`), `docList()` (return empty), `docUpsert()` (no-op), and grant methods. Since `Store` is from `bun:sqlite`, the simplest approach is to create an in-memory SQLite database using the real `createStore()` — this avoids mocking the entire Store interface.

4. **Mock persona file** — Write a temp file with minimal persona text. The agent reads `deps.personaPath` as a file path.

5. **Mock ToolRegistry override** — For tests that need to register native tools, the test creates its own registry via `createAgentTools()` won't work (it needs real deps). Instead, test the dispatch logic by:
   - Creating a real agent with mocked deps
   - Having the mock model return a tool_use block with a native tool name
   - Registering a native tool handler in the agent's tool creation path

   Since `createAgentTools()` is called inside `_chatImpl`, the test cannot directly inject tools. The cleaner approach: test `formatNativeToolResult` and the dispatch routing separately from the full agent loop.

For the full agent loop test, the mock model should return tool_use blocks. The dispatch routing in the agent checks `block.name === 'execute_code'` — any other name goes to `registry.execute()`. Since the registry only has sandbox-mode tools registered by `createAgentTools()`, calling a name that doesn't exist in the registry will throw. The test should verify:
- `execute_code` tool_use blocks go through `deps.runtime.execute()`
- Non-`execute_code` tool_use blocks go through `registry.execute()` (which throws for unknown tools — confirming the path is taken)

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Test file compiles.

**Commit:** Do not commit yet.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Write agent loop dispatch routing tests

**Verifies:** GH03.AC5.1, GH03.AC6.1, GH03.AC10.1, GH03.AC11.1

**Files:**
- Modify: `src/agent/agent.test.ts`

**Testing:**
Tests must verify each AC:

- **GH03.AC6.1 / GH03.AC11.1 (execute_code path):** Create agent with mock model that returns a tool_use block with `name: 'execute_code'` and `input: { code: 'output("hello")' }` on the first call, then returns an end_turn text response on the second call. Mock runtime's `execute()` should return `{ success: true, output: 'hello', error: null, duration_ms: 1 }`. Verify that `runtime.execute` was called with the code string. Verify the final chat result contains text from the model's second response.

- **GH03.AC5.1 / GH03.AC10.1 (native tool path):** Create agent with mock model that returns a tool_use block with `name: 'some_native_tool'` on the first call, then returns an end_turn text response on the second call. Since `some_native_tool` is not registered in the registry, `registry.execute()` will throw `"Unknown tool: some_native_tool"`. Verify the tool result message contains the error `"Tool error: Unknown tool: some_native_tool"`. This confirms the native dispatch path was taken (not the sandbox path). Additionally, verify that `runtime.execute` was NOT called — confirming the tool did not go through the Deno sandbox.

- **GH03.AC10.1 (native tool success path):** To test a successful native tool dispatch end-to-end, the approach depends on how `createAgentTools` works. Since the test controls `deps`, and `createAgentTools` is called inside `_chatImpl` with those deps, the simplest route is to verify via the error path (above) that native routing works. For a positive test, consider testing `formatNativeToolResult` directly (it's a module-level function — may need to be exported for testing, or test it indirectly through the agent).

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass.

**Commit:** Do not commit yet.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Write formatNativeToolResult tests

**Verifies:** GH03.AC5.1, GH03.AC7.1

**Files:**
- Modify: `src/agent/agent.ts` (export `formatNativeToolResult` for testing)
- Modify: `src/agent/agent.test.ts` (add tests)

**Implementation:**

Export `formatNativeToolResult` from `agent.ts` so it can be tested directly. Change from:

```typescript
function formatNativeToolResult(
```

to:

```typescript
export function formatNativeToolResult(
```

**Testing:**
Tests must verify:

- **String result:** `formatNativeToolResult('id1', 'hello')` returns `{ type: 'tool_result', tool_use_id: 'id1', content: 'hello' }`.
- **Object result:** `formatNativeToolResult('id1', { key: 'value' })` returns content as `JSON.stringify({ key: 'value' })`.
- **Undefined result:** Returns content `'(no output)'`.
- **Image result:** `formatNativeToolResult('id1', { type: 'image_result', text: 'An image', image: { data: 'base64data', media_type: 'image/png' } })` returns content as an array with a text block and an image_url block whose URL is a data URI.
- **Image result with missing image:** `formatNativeToolResult('id1', { type: 'image_result', text: 'An image' })` returns content as an array with just the text block (no image block since image data is missing).

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass.

Run: `bun test`
Expected: All tests across the project pass.

**Commit:**
```bash
git add src/agent/agent.ts src/agent/agent.test.ts
git commit -m "test(agent): add integration tests for native tool dispatch and result formatting"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Final verification

**Implementation:**

Run the full type check and test suite to confirm everything works together.

**Verification:**

Run: `bunx tsc --noEmit`
Expected: Zero type errors.

Run: `bun test`
Expected: All tests pass.

Run: `bun run build`
Expected: Build succeeds.

**Commit:** No commit needed — verification only.
<!-- END_TASK_4 -->
