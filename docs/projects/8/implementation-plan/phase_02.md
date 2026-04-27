# GH08: Summarization Tool — Phase 2: Tests

**Goal:** Verify the summarize tool's behavior through automated tests covering all acceptance criteria.

**Architecture:** Tests use `bun:test` with a mock `SubAgentLLM` to verify prompt construction, parameter handling, truncation, and error cases. No real LLM calls.

**Tech Stack:** bun:test

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase tests:

### GH08.AC1: Sub-agent invocation
- **GH08.AC1.1:** `summarize` sends text to sub-agent with appropriate system prompt

### GH08.AC2: Input truncation
- **GH08.AC2.1:** Input truncated at 100k chars

### GH08.AC3: Length guidance mapping
- **GH08.AC3.1:** `max_length` maps to correct length guidance

### GH08.AC4: Optional instructions
- **GH08.AC4.1:** Optional `instructions` appended to prompt as focus guidance

### GH08.AC5: Missing sub-agent error
- **GH08.AC5.1:** Missing sub-agent produces clear error message

---

## Phase 2: Tests

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create test file for summarize tool

**Verifies:** GH08.AC1.1, GH08.AC2.1, GH08.AC3.1, GH08.AC4.1, GH08.AC5.1

**Files:**
- Create: `src/tools/summarize.test.ts`

**Implementation:**

This project has no existing test files, so this will be the first. Bun's test runner discovers `*.test.ts` files automatically — no configuration needed.

The test strategy: create a mock `SubAgentLLM` that captures the `prompt` and `system` arguments passed to `complete()`, then assert against the captured values. This tests the tool's prompt construction behavior without calling a real LLM.

You'll also need a minimal mock `ToolRegistry` since `registerSummarizeTools` calls `registry.register()`. The simplest approach: use the real `createToolRegistry()` from `src/runtime/tool-registry.ts` and call `registry.execute('summarize', params)` to invoke the handler.

For `AgentDependencies`, only `subAgent` matters for this tool. Create a partial mock that satisfies the type with just `subAgent` set. Cast as needed to avoid mocking the entire dependency tree.

**Test cases to write:**

1. **AC1.1 — sends text to sub-agent with system prompt:**
   - Call `summarize` with `{ text: 'Some content to summarize' }`
   - Assert the mock's captured `system` argument equals the expected summarization system prompt (`'You are a precise summarization assistant...'`)
   - Assert the mock's captured `prompt` argument contains the input text
   - Assert the result contains `{ summary: <mock return value> }`

2. **AC2.1 — input truncated at 100k chars:**
   - Call `summarize` with `{ text: 'x'.repeat(200_000) }` (200k chars)
   - Assert the mock's captured `prompt` contains at most ~100,000 chars of the input text (the prompt has some overhead from the instruction prefix, but the text portion should be 100k)
   - A practical check: assert `prompt.length < 100_200` (allowing for the instruction prefix)

3. **AC3.1 — max_length maps to correct guidance:**
   - Call `summarize` with `{ text: 'test', max_length: 'short' }` -> assert prompt contains `'Respond in 2-3 sentences.'`
   - Call `summarize` with `{ text: 'test', max_length: 'medium' }` -> assert prompt contains `'Respond in 1-2 paragraphs.'`
   - Call `summarize` with `{ text: 'test', max_length: 'long' }` -> assert prompt contains `'Respond in up to 4 paragraphs.'`
   - Call `summarize` with `{ text: 'test' }` (no max_length) -> assert prompt contains `'Respond in 1-2 paragraphs.'` (default medium)

4. **AC4.1 — instructions appended as focus guidance:**
   - Call `summarize` with `{ text: 'test', instructions: 'focus on technical claims' }`
   - Assert the mock's captured `prompt` contains `'Focus: focus on technical claims'`

5. **AC4.1 (negative) — no instructions, no focus line:**
   - Call `summarize` with `{ text: 'test' }` (no instructions)
   - Assert the mock's captured `prompt` does NOT contain `'Focus:'`

6. **AC5.1 — missing sub-agent throws clear error:**
   - Register the tool with `deps.subAgent` set to `undefined`
   - Call `summarize` with `{ text: 'test' }`
   - Assert the call throws/rejects with an error message containing `'Sub-agent LLM not configured'`

**Test skeleton:**

```typescript
// src/tools/summarize.test.ts
import { describe, test, expect } from 'bun:test';
import { createToolRegistry } from '../runtime/tool-registry.ts';
import { registerSummarizeTools } from './summarize.ts';
import type { AgentDependencies } from '../agent/types.ts';

function makeMockSubAgent() {
  let capturedPrompt = '';
  let capturedSystem = '';
  return {
    captured: { get prompt() { return capturedPrompt; }, get system() { return capturedSystem; } },
    subAgent: {
      async complete(prompt: string, system?: string): Promise<string> {
        capturedPrompt = prompt;
        capturedSystem = system ?? '';
        return 'Mock summary result.';
      },
    },
  };
}

function setupRegistry(subAgent?: { complete(prompt: string, system?: string): Promise<string> }) {
  const registry = createToolRegistry();
  const deps = { subAgent } as unknown as AgentDependencies;
  registerSummarizeTools(registry, deps);
  return registry;
}

describe('summarize tool', () => {
  // Test cases 1-6 as described above
});
```

**Testing:**

Run: `bun test`
Expected: All 6+ test cases pass.

**Verification:**

Run: `bun test`
Expected: `6 pass` (or however many individual test cases you wrote). Zero failures.

**Commit:** `test: add summarize tool tests (GH08)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify end-to-end build

**Verifies:** None (final verification)

**Files:** None (read-only verification)

**Steps:**

1. Run `bun run build` — expected: succeeds
2. Run `bun test` — expected: all tests pass
3. Verify no TypeScript errors: `bunx tsc --noEmit` — expected: clean

**Commit:** No commit needed. This is a verification step.
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
