# GH11: Extended Thinking / Reasoning Content Preservation — Phase 3

**Goal:** Wire reasoning content through the agent loop (attach to assistant messages in history), include it in compaction serialization, and add a test proving the end-to-end flow.

**Architecture:** The agent loop in `agent.ts` builds an `assistantMessage` from the model response. We attach `reasoning_content` from the response to the message. The compaction serializer in `compaction.ts` already formats messages into markdown — we prepend reasoning content as a separate section when present. A new test file verifies the full flow: mock model returns reasoning, verify it lands on the history message and appears in compaction output.

**Tech Stack:** TypeScript strict mode, Bun runtime, Bun test runner

**Scope:** 3 phases total (this is phase 3 of 3)

**Codebase verified:** 2026-04-27 via direct investigation

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH11.AC6: Agent loop attaches reasoning to assistant messages in history
- **GH11.AC6.1 Success:** When `response.reasoning_content` is present, it is set on the assistant message pushed to history
- **GH11.AC6.2 No-op:** When `response.reasoning_content` is undefined, the message has no `reasoning_content` field

### GH11.AC7: Compaction serializer includes reasoning content when formatting
- **GH11.AC7.1 Success:** When an assistant message has `reasoning_content`, `formatConversation()` includes it in the output as `### assistant (reasoning)\n{reasoning_content}` before the main `### assistant\n{content}` block
- **GH11.AC7.2 No-op:** When no `reasoning_content` is present, formatting is unchanged

### GH11.AC8: No display in TUI (preserved in data only)
- **GH11.AC8.1 Verification:** No changes to any TUI component. Reasoning content exists only on the `Message` type and in compaction output.

### GH11.AC9: Test — mock model response with reasoning, verify stored on assistant message
- **GH11.AC9.1 Success:** A test with a mock model returning `reasoning_content` verifies the field appears on the assistant message in history
- **GH11.AC9.2 Success:** A test verifies `formatConversation()` includes reasoning in the serialized output

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Agent loop — attach reasoning to assistant message

**Verifies:** GH11.AC6.1, GH11.AC6.2

**Files:**
- Modify: `src/agent/agent.ts:177` (assistant message construction)

**Implementation:**

In `_chatImpl`, after the model call, the assistant message is constructed at line 177:

```typescript
const assistantMessage: Message = { role: 'assistant', content: response.content };
```

Add reasoning content propagation immediately after this line:

```typescript
const assistantMessage: Message = { role: 'assistant', content: response.content };
if (response.reasoning_content) {
  assistantMessage.reasoning_content = response.reasoning_content;
}
```

This is a simple conditional assignment. When `reasoning_content` is undefined (the common case for most models), nothing happens. When present (e.g., Anthropic thinking blocks, OpenRouter reasoning), it's preserved on the message in history.

**Note on TUI (GH11.AC8):** No TUI files need changes. The `ChatResult` type returned by `chat()` contains only `text` and `stats` — reasoning content is preserved in the internal `history` array and in compaction output, but never surfaced to the UI layer.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors.

**Commit:** `feat(agent): attach reasoning_content to assistant messages in history`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Compaction — include reasoning in formatted conversation

**Verifies:** GH11.AC7.1, GH11.AC7.2

**Files:**
- Modify: `src/agent/compaction.ts:19-37` (formatConversation function)

**Implementation:**

The `formatConversation` function serializes messages into markdown for context compaction. Currently it formats each message as `### {role}\n{content}`. When an assistant message has `reasoning_content`, we should include it so the summarizer can see the model's reasoning chain.

The current function (lines 19-37):

```typescript
function formatConversation(messages: ReadonlyArray<Message>): string {
  return messages
    .map((msg) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((block) => {
                if (block.type === 'text') return block.text;
                if (block.type === 'image_url') return '[image]';
                if (block.type === 'tool_use') return `[tool_use: ${block.name}]`;
                if (block.type === 'tool_result') return `[tool_result: ${block.content?.toString().slice(0, 200) ?? ''}]`;
                return '';
              })
              .filter(Boolean)
              .join('\n');
      return `### ${msg.role}\n${content}`;
    })
    .join('\n\n');
}
```

Replace it with:

```typescript
function formatConversation(messages: ReadonlyArray<Message>): string {
  return messages
    .map((msg) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((block) => {
                if (block.type === 'text') return block.text;
                if (block.type === 'image_url') return '[image]';
                if (block.type === 'tool_use') return `[tool_use: ${block.name}]`;
                if (block.type === 'tool_result') return `[tool_result: ${block.content?.toString().slice(0, 200) ?? ''}]`;
                return '';
              })
              .filter(Boolean)
              .join('\n');

      const sections: string[] = [];
      if (msg.reasoning_content) {
        sections.push(`### ${msg.role} (reasoning)\n${msg.reasoning_content}`);
      }
      sections.push(`### ${msg.role}\n${content}`);
      return sections.join('\n\n');
    })
    .join('\n\n');
}
```

When `reasoning_content` is present, the output for that message becomes:

```
### assistant (reasoning)
{reasoning text here}

### assistant
{actual response content}
```

When absent, output is identical to the previous format: `### assistant\n{content}`.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors.

**Commit:** `feat(compaction): include reasoning_content in formatted conversation`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Test — reasoning content flows through agent loop

**Verifies:** GH11.AC9.1

**Files:**
- Create: `src/agent/agent.test.ts`

**Implementation:**

Create a test that exercises the agent loop with a mock model that returns `reasoning_content`. The test verifies that the reasoning appears on the assistant message in history.

The test needs to mock several dependencies:
- `ModelProvider` — returns a `ModelResponse` with `reasoning_content` and `stop_reason: 'end_turn'`
- `CodeRuntime` — not needed (model stops on first call, no tool use)
- `Store` — minimal mock that returns empty docs
- `personaPath` — points to a temp file with a basic persona

Key behavior to test:
- Call `agent.chat("test")` with a model mock that returns `reasoning_content: "I thought about this carefully"`
- The agent's internal history is not directly exposed, but we can verify via a second call: override conversation with the history from a captured mock
- Alternatively, since `createAgent` doesn't expose history, test the `formatConversation` integration path instead (see Task 4)

A more direct approach: since the agent returns `ChatResult` with only `text` and `stats`, and reasoning is preserved internally, the most valuable test is to verify that a model response with reasoning doesn't break the agent loop and that the text response is correctly extracted. The reasoning preservation is structural (type system enforces it once the field is set).

However, for a proper behavioral test, we can use `conversationOverride` to inject a message with reasoning and verify the model receives it back on subsequent calls. Here's the approach:

```typescript
import { describe, test, expect } from 'bun:test';
import { createAgent } from './agent.ts';
import type { ModelResponse, Message } from '../model/types.ts';
import type { AgentDependencies } from './types.ts';

// Track what the model receives so we can inspect history
const receivedMessages: Message[][] = [];

const mockModel = {
  async complete(request: { messages: ReadonlyArray<Message> }): Promise<ModelResponse> {
    receivedMessages.push([...request.messages]);
    return {
      content: [{ type: 'text', text: 'I have responded.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      reasoning_content: 'Let me think step by step about this problem.',
    };
  },
};
```

The full test creates an agent with minimal mocks, calls `chat()`, then calls `chat()` again and inspects the messages sent to the model on the second call. The second call's messages should include the assistant message from the first call, which should have `reasoning_content` set.

**Testing pattern notes:**
- Bun test runner is used (`bun test`)
- No existing test files in the codebase, so this establishes the pattern
- The persona file must exist — use `Bun.write` to create a temp file
- Store mock needs `docGet`, `docList` methods minimum (used by `loadCoreMemoryFromStore` and skill listing)

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && bun test src/agent/agent.test.ts`
Expected: Test passes.

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Test — formatConversation includes reasoning

**Verifies:** GH11.AC9.2

**Files:**
- Create: `src/agent/compaction.test.ts`

**Implementation:**

Test the `formatConversation` function directly. This is a pure function — much easier to test in isolation than the full agent loop.

Problem: `formatConversation` is not exported (it's a module-private function in `compaction.ts`). Two options:

**Option A (preferred):** Export `formatConversation` from `compaction.ts`. It's a pure function with no side effects — there's no reason to hide it, and exporting it enables direct testing.

**Option B:** Test indirectly through `compactContext`, which is exported but requires store + model mocks.

Go with Option A. Add `export` to `formatConversation`:

In `src/agent/compaction.ts`, change line 19 from:
```typescript
function formatConversation(messages: ReadonlyArray<Message>): string {
```
to:
```typescript
export function formatConversation(messages: ReadonlyArray<Message>): string {
```

Then create the test:

```typescript
import { describe, test, expect } from 'bun:test';
import { formatConversation } from './compaction.ts';
import type { Message } from '../model/types.ts';

describe('formatConversation', () => {
  test('includes reasoning_content when present on assistant message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        content: 'The answer is 4.',
        reasoning_content: 'Simple arithmetic: 2+2=4.',
      },
    ];

    const result = formatConversation(messages);

    expect(result).toContain('### assistant (reasoning)');
    expect(result).toContain('Simple arithmetic: 2+2=4.');
    expect(result).toContain('### assistant\nThe answer is 4.');
  });

  test('omits reasoning section when reasoning_content is absent', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const result = formatConversation(messages);

    expect(result).not.toContain('(reasoning)');
    expect(result).toContain('### assistant\nHi there');
  });
});
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && bun test src/agent/compaction.test.ts`
Expected: Both tests pass.

**Commit:** `test(GH11): add tests for reasoning_content in agent loop and compaction`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
