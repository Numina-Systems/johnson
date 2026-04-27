# GH01: Graceful Max-Iteration Exhaustion — Implementation Plan

**Goal:** When the agent's tool loop exhausts `maxToolRounds`, produce a coherent text response instead of silently returning whatever was in the last (likely incomplete) assistant message.

**Architecture:** Add an `exitedNormally` flag to the existing `for` loop in `_chatImpl`. When the loop exits without an `end_turn`/`max_tokens` break, push a system nudge and make one final model call with `tools: []` to force a text-only wrap-up.

**Tech Stack:** TypeScript, Bun test runner (`bun:test`)

**Scope:** 1 phase (complete feature)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH01.AC1: System nudge on exhaustion
- **GH01.AC1.1 Success:** When maxToolRounds exhausted, a system nudge message appears in history

### GH01.AC2: Forced text-only final call
- **GH01.AC2.1 Success:** A final model call with `tools: []` produces a text response
- **GH01.AC2.2 Success:** Usage stats from the final call are included in `ChatStats`
- **GH01.AC2.3 Success:** `rounds` count includes the final call

### GH01.AC3: Normal exit unaffected
- **GH01.AC3.1 Success:** When the loop exits via `end_turn` or `max_tokens`, no nudge is injected and no extra model call is made

### GH01.AC4: Integration test
- **GH01.AC4.1 Success:** Mock model that always returns `tool_use` produces a final forced text response after maxToolRounds

---

## Phase 1: Flag-Based Exhaustion Detection and Forced Final Response

This is a functionality phase. All changes are in `src/agent/agent.ts` with a new test file at `src/agent/agent.test.ts`.

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Add `exitedNormally` flag and forced final response logic

**Verifies:** GH01.AC1.1, GH01.AC2.1, GH01.AC2.2, GH01.AC2.3, GH01.AC3.1

**Files:**
- Modify: `src/agent/agent.ts:147-233` (the tool loop and the code immediately after it)

**Implementation:**

Before the `for` loop at line 148, add:

```typescript
let exitedNormally = false;
```

Inside the `end_turn`/`max_tokens` break at line 181-184, set the flag before breaking:

```typescript
if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
  process.stderr.write(`[agent] loop exiting: ${response.stop_reason}\n`);
  exitedNormally = true;
  break;
}
```

After the closing `}` of the `for` loop (line 233) and before the `// f. Extract final text` comment (line 235), insert the forced final response block:

```typescript
    // g. Handle max-iteration exhaustion — force a text-only wrap-up
    if (!exitedNormally) {
      process.stderr.write(`[agent] max tool rounds (${deps.config.maxToolRounds}) exhausted, forcing final response\n`);

      history.push({
        role: 'user',
        content: '[System: Max tool calls reached. Provide final response now.]',
      });

      const finalResponse = await deps.model.complete({
        system: systemPrompt,
        messages: history,
        tools: [],
        model: deps.config.model,
        max_tokens: deps.config.maxTokens,
        temperature: deps.config.temperature,
        timeout: deps.config.modelTimeout,
      });

      rounds++;
      totalInputTokens += finalResponse.usage.input_tokens;
      totalOutputTokens += finalResponse.usage.output_tokens;

      history.push({ role: 'assistant', content: finalResponse.content });
    }
```

**Key details:**
- `tools: []` prevents the model from returning `tool_use` blocks — it must produce text.
- The nudge is a plain string user message, not an array of content blocks. This matches how the agent already pushes user messages (line 121).
- Usage stats are accumulated into the existing `totalInputTokens`/`totalOutputTokens`/`rounds` variables. The final `ChatStats` object at line 246 already reads from these, so no further changes needed.
- The existing text extraction logic at line 235-263 handles the rest — it finds the last assistant message and extracts text blocks. Since the forced response is the last assistant message and contains only text blocks (no `tool_use` possible), it works as-is.

**Verification:**
Run: `bun run build`
Expected: Build succeeds with no type errors

**Commit:** `feat(agent): add exitedNormally flag and forced final response on max-iteration exhaustion`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Write tests for max-iteration exhaustion

**Verifies:** GH01.AC1.1, GH01.AC2.1, GH01.AC2.2, GH01.AC2.3, GH01.AC3.1, GH01.AC4.1

**Files:**
- Create: `src/agent/agent.test.ts`

**Context for test construction:**

The `createAgent` function (exported from `src/agent/agent.ts`) takes an `AgentDependencies` object. The key deps to mock are:

1. **`model: ModelProvider`** — needs a `complete()` method returning `ModelResponse`. The mock controls `stop_reason` and `content` to simulate tool_use vs end_turn behaviour.

2. **`runtime: CodeRuntime`** — needs an `execute()` method returning `ExecutionResult`. For these tests, the runtime mock just returns a success result since we're testing loop exit behaviour, not tool execution.

3. **`store: Store`** — the agent calls `store.docGet('self')` and `store.docList(500)` during prompt building. Mock these to return minimal data.

4. **`config: AgentConfig`** — set `maxToolRounds` to a small number (e.g., 2 or 3) to trigger exhaustion quickly.

5. **`personaPath: string`** — points to a file read with `Bun.file().text()`. Create a temp file or use an existing fixture.

The agent also writes to `src/runtime/deno/tools.ts` via `Bun.write`. Ensure the directory exists or mock accordingly.

**Testing:**

Tests must verify each AC listed above:

- **GH01.AC1.1:** After the model returns `tool_use` for every round up to `maxToolRounds`, assert that history contains a user message with content `'[System: Max tool calls reached. Provide final response now.]'`.

- **GH01.AC2.1:** Assert the mock model's `complete` was called one final time after the loop with `tools: []` in the request, and the returned `ChatResult.text` contains the forced response text.

- **GH01.AC2.2:** Assert `ChatResult.stats.inputTokens` and `stats.outputTokens` include the usage from the final forced call (sum of all rounds including the forced one).

- **GH01.AC2.3:** Assert `ChatResult.stats.rounds` equals `maxToolRounds + 1` (the loop rounds plus the forced final call).

- **GH01.AC3.1:** When the model returns `end_turn` on the first call, assert no nudge message in history, `stats.rounds` equals 1, and `complete` was called exactly once.

- **GH01.AC4.1:** End-to-end mock scenario: model always returns `tool_use` except when called with `tools: []` (then returns text). Verify the agent returns the forced text response and all stats are correct.

**Mock strategy:**

The model mock should track call count and inspect the `tools` parameter:
- When `tools` contains `EXECUTE_CODE_TOOL`: return a `tool_use` response with a dummy tool call
- When `tools` is `[]`: return an `end_turn` response with a text block containing known text (e.g., `"Forced wrap-up response"`)

The runtime mock returns `{ success: true, output: 'ok', error: null, duration_ms: 0 }` for all executions.

The store mock returns `null` for `docGet` and `{ documents: [], total: 0 }` for `docList`.

Create a temp persona file using `Bun.write` in a `beforeAll` block pointing to a temp directory (`import { mkdtemp } from 'node:fs/promises'`), containing minimal persona text.

**Verification:**
Run: `bun test`
Expected: All tests pass

**Commit:** `test(agent): add tests for graceful max-iteration exhaustion`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Run full verification

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Build succeeds with no type errors

Run: `bun test`
Expected: All tests pass

Run: `bun run build && bun test`
Expected: Both succeed

This task has no commit — it's a verification gate.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final commit

**Files:** None (commit only — all changes from Tasks 1-2 should already be committed)

**Verification:**

Run: `git status`
Expected: Working tree clean, all changes committed

Run: `git log --oneline -3`
Expected: Two commits visible — implementation and tests

This task exists to ensure everything is committed and the branch is clean.
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
