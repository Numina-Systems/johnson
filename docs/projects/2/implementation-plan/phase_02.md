# GH02: Event Emission / Lifecycle Hooks — Phase 2

**Goal:** Wire the emit helper into the agent loop and add the four lifecycle event emission points, with an integration test proving correct ordering and error resilience.

**Architecture:** Create a local `emit` helper inside `_chatImpl` that guards on `options?.onEvent`, catches callback errors, and logs to stderr. Insert four `await emit(...)` calls at the defined points in the tool loop. The test mocks `ModelProvider` and `CodeRuntime` to drive one full tool-use round and asserts all four events fire in order.

**Tech Stack:** TypeScript (bun runtime, bun:test)

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

### GH02.AC3: All four events fire in order
- **GH02.AC3.1 Success:** Events fire in order `llm_start` -> `llm_done` -> `tool_start` -> `tool_done` during a tool-use round
- **GH02.AC3.2 Success:** `llm_start` and `llm_done` also fire on the final `end_turn` round (no tool dispatch, so no `tool_start`/`tool_done`)

### GH02.AC4: Callback errors are logged, not thrown
- **GH02.AC4.1 Success:** If `onEvent` throws, the error is written to stderr and the agent loop continues
- **GH02.AC4.2 Success:** The agent produces a normal `ChatResult` even when `onEvent` throws on every call

### GH02.AC5: Code preview in tool_start truncated to 500 chars
- **GH02.AC5.1 Success:** `tool_start` event `data.code` is at most 500 characters even when the submitted code is longer

### GH02.AC6: Result preview in tool_done truncated to 200 chars
- **GH02.AC6.1 Success:** `tool_done` event `data.preview` is at most 200 characters even when the tool output is longer

### GH02.AC7: Integration test verifies full event sequence
- **GH02.AC7.1 Success:** Test provides `onEvent` callback, runs chat with tool use, verifies all four event kinds fire in correct order

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add emit helper and four emission points to agent loop

**Verifies:** GH02.AC3.1, GH02.AC3.2, GH02.AC4.1, GH02.AC4.2, GH02.AC5.1, GH02.AC6.1

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

There are three changes to `_chatImpl` in `src/agent/agent.ts`:

**1a. Add the emit helper** inside `_chatImpl`, immediately after the line `const chatStart = performance.now();` (line 73). This goes before any loop logic:

```typescript
    const emit = async (kind: AgentEventKind, data: Record<string, unknown>): Promise<void> => {
      if (!options?.onEvent) return;
      try {
        await options.onEvent({ kind, data });
      } catch (err) {
        process.stderr.write(`[agent] event callback error (${kind}): ${err}\n`);
      }
    };
```

This also requires adding `AgentEventKind` to the import from `./types.ts`. Update the import on line 11:

```typescript
import type { Agent, AgentDependencies, ChatContext, ChatImage, ChatResult, ChatStats, ChatOptions, AgentEventKind } from './types.ts';
```

**1b. Add llm_start and llm_done emit calls** in the tool loop. The tool loop starts at line 148. The emit points wrap the `deps.model.complete()` call:

Before the `deps.model.complete()` call (before line 151 `response = await deps.model.complete({`):

```typescript
        await emit('llm_start', { round });
```

After the model response is received and usage stats are accumulated (after line 170 `totalOutputTokens += response.usage.output_tokens;`), before the debug `process.stderr.write`:

```typescript
        await emit('llm_done', { round, usage: response.usage, stop_reason: response.stop_reason });
```

**1c. Add tool_start and tool_done emit calls** inside the `toolUseBlocks.map()` callback. Currently (lines 201-223) each tool block is processed. Wrap the runtime execution:

Inside the `toolUseBlocks.map(async (block) => { ... })` callback, after the `code` extraction and validation (after line 204's `typeof code !== 'string'` guard), before the `onToolCall` declaration:

```typescript
                await emit('tool_start', { tool: 'execute_code', code: (code as string).slice(0, 500) });
```

After `const result = await deps.runtime.execute(code, undefined, onToolCall);` (after line 213) and before building the output string:

```typescript
                await emit('tool_done', { tool: 'execute_code', success: result.success, preview: (result.output ?? '').slice(0, 200) });
```

Note: The `tool_start` emit uses `.slice(0, 500)` and `tool_done` uses `.slice(0, 200)` per the design's truncation requirements.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bunx tsc --noEmit`
Expected: No type errors.

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bun run build`
Expected: Build succeeds.

**Commit:** `feat(agent): emit lifecycle events in agent loop`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integration test for event emission

**Verifies:** GH02.AC3.1, GH02.AC3.2, GH02.AC4.1, GH02.AC4.2, GH02.AC5.1, GH02.AC6.1, GH02.AC7.1

**Files:**
- Create: `src/agent/agent.test.ts`

**Implementation:**

This is the project's first test file. It uses `bun:test` (bun's built-in test runner, already configured via `"test": "bun test"` in `package.json`).

The test strategy is to create mock implementations of `ModelProvider`, `CodeRuntime`, and `Store`, then call `createAgent()` and exercise `chat()` with an `onEvent` callback that records events.

The mock model should return two responses:
1. First call: `stop_reason: 'tool_use'` with an `execute_code` tool_use block (triggers tool dispatch, so all 4 events fire)
2. Second call: `stop_reason: 'end_turn'` with a text block (triggers `llm_start` and `llm_done` only)

This produces the expected event sequence: `llm_start`, `llm_done`, `tool_start`, `tool_done`, `llm_start`, `llm_done`.

The test file needs these test cases:

**Test 1: "emits all four event kinds in correct order during tool-use round"**
- Create agent with mocked deps
- Call `chat("hello", { onEvent })` where `onEvent` pushes event kinds to an array
- Assert the collected kinds array equals `['llm_start', 'llm_done', 'tool_start', 'tool_done', 'llm_start', 'llm_done']`

**Test 2: "callback errors are logged, not thrown"**
- Create agent with mocked deps
- Provide an `onEvent` that throws on every call
- Assert `chat()` resolves successfully (does not reject)
- Assert the result has a non-empty `text` field

**Test 3: "tool_start code is truncated to 500 chars"**
- Mock the model to submit code longer than 500 characters in the tool_use block
- Collect events via `onEvent`
- Find the `tool_start` event and assert `data.code.length <= 500`

**Test 4: "tool_done preview is truncated to 200 chars"**
- Mock the runtime to return output longer than 200 characters
- Collect events via `onEvent`
- Find the `tool_done` event and assert `data.preview.length <= 200`

**Mocking notes for the implementor:**

The `Store` interface (from `src/store/store.ts`) is the hardest to mock because the agent calls `deps.store.docList()` and `loadCoreMemoryFromStore(deps.store)`. The minimal mock needs:
- `docList()` returning `{ documents: [], total: 0 }`
- `docGet()` returning `null` (the `loadCoreMemoryFromStore` function calls `store.docGet('self')`)

The `CodeRuntime` mock needs `execute()` returning `{ success: true, output: 'ok', error: null, duration_ms: 1 }`.

The persona file (`deps.personaPath`) must point to a real readable file. Create a temp file with minimal content like `"You are a test agent."` or use `Bun.write` in a `beforeAll`.

The `AgentConfig` needs all required fields:
```typescript
{
  model: 'test-model',
  maxTokens: 1024,
  maxToolRounds: 5,
  contextBudget: 100000,
  contextLimit: 128000,
  modelTimeout: 30000,
  timezone: 'UTC',
}
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bun test`
Expected: All 4 test cases pass.

**Commit:** `test(agent): add event emission integration tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
