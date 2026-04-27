# GH05: Auto-Generated Session Titles — Phase 1

**Goal:** Create the `session-title.ts` module with all business logic and the `SubAgentLLM` type contract, plus update `ChatOptions` with `sessionId`.

**Architecture:** Pure function that takes store, session ID, sub-agent, and message history. Guards skip silently when preconditions aren't met. Title generation calls a sub-agent LLM, post-processes the result, and persists via the store. The `SubAgentLLM` type is defined here as a minimal interface contract that #4 will implement.

**Tech Stack:** TypeScript, Bun test runner, `bun:sqlite` (via Store interface)

**Scope:** 2 phases from design (phase 1 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH05.AC1: Title generation guards
- **GH05.AC1.1:** Title generated only when: sub-agent available, session has no title, 2+ user messages
- **GH05.AC8.1:** Test: session already has title -> verify sub-agent not called
- **GH05.AC9.1:** Test: fewer than 2 user messages -> verify sub-agent not called

### GH05.AC2: Sub-agent invocation
- **GH05.AC2.1:** Sub-agent called with first 10 messages formatted as text

### GH05.AC3: Post-processing
- **GH05.AC3.1:** Result post-processed: quotes stripped, punctuation stripped, first line, 80 char cap

### GH05.AC4: Persistence
- **GH05.AC4.1:** Title persisted via `store.updateSessionTitle()`

### GH05.AC5: Non-blocking
- **GH05.AC5.1:** Non-blocking -- errors swallowed silently

### GH05.AC6: ChatOptions
- **GH05.AC6.1:** `sessionId` available on `ChatOptions`

### GH05.AC7: Happy path
- **GH05.AC7.1:** Test: mock sub-agent returns title -> verify store updated

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Define SubAgentLLM type and update ChatOptions

**Verifies:** GH05.AC6.1

**Files:**
- Modify: `src/agent/types.ts:62-66`

**Implementation:**

**IMPORTANT — SubAgentLLM type alignment with GH04:** Do NOT create a separate `src/agent/sub-agent-types.ts` file. GH04 (Sub-Agent LLM) defines and exports `SubAgentLLM` from `src/model/sub-agent.ts` with the exact same signature: `complete(prompt: string, system?: string): Promise<string>`. GH04 also adds `subAgent?: SubAgentLLM` to `AgentDependencies` in its Phase 3.

Since GH05 depends on GH04 (per the DAG: `#5 → #4`), the `SubAgentLLM` type and the `subAgent` field on `AgentDependencies` will already exist when GH05 is implemented. Do NOT duplicate these definitions.

**What GH05 Task 1 actually needs to do:**

1. Verify that `SubAgentLLM` is exported from `src/model/sub-agent.ts` (added by GH04)
2. Verify that `AgentDependencies` already has `subAgent?: SubAgentLLM` (added by GH04 Phase 3)
3. Only add `sessionId` to `ChatOptions`

Update `ChatOptions` in `src/agent/types.ts` to add `sessionId`:

Current (lines 62-66):
```typescript
export type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
};
```

Updated:
```typescript
export type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
  readonly sessionId?: string;
};
```

No changes to `AgentDependencies` — GH04 Phase 3 already adds the `subAgent` field.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(GH05): add SubAgentLLM type contract and sessionId to ChatOptions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement maybeGenerateSessionTitle

**Verifies:** GH05.AC1.1, GH05.AC2.1, GH05.AC3.1, GH05.AC4.1, GH05.AC5.1

**Files:**
- Create: `src/agent/session-title.ts`

**Implementation:**

Create `src/agent/session-title.ts` with the `maybeGenerateSessionTitle` function. This module follows the `Functional Core` pattern for the pure post-processing logic and `Imperative Shell` for the async orchestration.

```typescript
// pattern: Imperative Shell — async coordination with sub-agent and store

import type { Store } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Message } from '../model/types.ts';

const MAX_MESSAGES = 10;
const MAX_CONTENT_LENGTH = 200;
const MAX_TITLE_LENGTH = 80;

const TITLE_SYSTEM_PROMPT =
  'Summarize the topic of this short conversation as a concise title ' +
  '(5-8 words, no quotes, no trailing punctuation, plain text only). ' +
  'Respond with only the title.';

/**
 * Format messages for the title generation prompt.
 * Takes the first N messages, truncates each to a readable summary.
 */
function formatMessagesForTitle(messages: ReadonlyArray<Message>): string {
  return messages.slice(0, MAX_MESSAGES).map((msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join(' ');
    const truncated = content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '...'
      : content;
    return `${msg.role}: ${truncated}`;
  }).join('\n');
}

/**
 * Post-process a raw title from the sub-agent.
 * Strips quotes, trailing punctuation, takes first line, caps length.
 */
export function postProcessTitle(raw: string): string {
  let title = raw.trim();

  // Take first line only
  const newlineIdx = title.indexOf('\n');
  if (newlineIdx >= 0) {
    title = title.slice(0, newlineIdx).trim();
  }

  // Strip leading/trailing quotes (single and double)
  title = title.replace(/^["']+|["']+$/g, '');

  // Strip trailing punctuation
  title = title.replace(/[.!?]+$/, '');

  // Trim and cap length
  title = title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }

  return title;
}

/**
 * Generate a session title if conditions are met.
 * Skips silently when preconditions fail. Errors are swallowed.
 */
export async function maybeGenerateSessionTitle(
  store: Store,
  sessionId: string | undefined,
  subAgent: SubAgentLLM | undefined,
  messages: ReadonlyArray<Message>,
): Promise<void> {
  // Guard: no sub-agent configured
  if (!subAgent) return;

  // Guard: no session tracking
  if (!sessionId) return;

  // Guard: session already has a title
  const session = store.getSession(sessionId);
  if (session?.title) return;

  // Guard: fewer than 2 user messages
  const userMessageCount = messages.filter((m) => m.role === 'user').length;
  if (userMessageCount < 2) return;

  // Generate title
  const formatted = formatMessagesForTitle(messages);
  const raw = await subAgent.complete(formatted, TITLE_SYSTEM_PROMPT);
  const title = postProcessTitle(raw);

  if (title.length === 0) return;

  // Persist
  store.updateSessionTitle(sessionId, title);
}
```

Note: `postProcessTitle` is exported separately to allow direct unit testing of the pure post-processing logic.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(GH05): implement maybeGenerateSessionTitle`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for session-title module

**Verifies:** GH05.AC1.1, GH05.AC2.1, GH05.AC3.1, GH05.AC4.1, GH05.AC5.1, GH05.AC7.1, GH05.AC8.1, GH05.AC9.1

**Files:**
- Create: `src/agent/session-title.test.ts`

**Testing:**

This is the first test file in the project. Bun's test runner (`bun test`) picks up `*.test.ts` files automatically with no additional configuration.

Tests must verify each AC listed above. The store needs to be mocked since it's backed by SQLite. The `SubAgentLLM` is trivially mockable since it's a single-method interface.

Create a mock store that implements only the methods `maybeGenerateSessionTitle` calls: `getSession` and `updateSessionTitle`. Use a partial mock pattern -- create an object with just those two methods plus stubs for the rest.

Create a mock sub-agent that returns a configurable string.

Tests to write:

- **GH05.AC7.1 (happy path):** 2+ user messages, no existing title, sub-agent returns `"Discussing AI Agents"` -> verify `updateSessionTitle` was called with the session ID and processed title
- **GH05.AC8.1 (session has title):** Session already has title `"Existing Title"` -> verify sub-agent `complete` was NOT called
- **GH05.AC9.1 (fewer than 2 user messages):** Only 1 user message in history -> verify sub-agent `complete` was NOT called
- **GH05.AC1.1 (no sub-agent):** Pass `undefined` as sub-agent -> verify no error thrown, `updateSessionTitle` NOT called
- **GH05.AC1.1 (no session ID):** Pass `undefined` as session ID -> verify no error thrown
- **GH05.AC5.1 (error swallowed):** Sub-agent throws an error -> verify the promise rejects (the caller in agent.ts will `.catch(() => {})` it; the function itself does not catch)
- **GH05.AC3.1 (post-processing):** Direct unit tests for `postProcessTitle`:
  - Strips double quotes: `'"Hello World"'` -> `'Hello World'`
  - Strips single quotes: `"'Hello World'"` -> `'Hello World'`
  - Strips trailing punctuation: `'Hello World.'` -> `'Hello World'`
  - Strips trailing `!` and `?`: `'Hello World!'`, `'Hello World?'`
  - Takes first line of multi-line: `'First Line\nSecond Line'` -> `'First Line'`
  - Truncates to 80 chars: a 100-char string -> 80 chars
  - Handles combined cases: `'"Hello World!"'` -> `'Hello World'`
- **GH05.AC2.1 (message formatting):** Verify sub-agent receives formatted messages with `role: content` format, content truncated to 200 chars, max 10 messages

**Verification:**
Run: `bun test src/agent/session-title.test.ts`
Expected: All tests pass

**Commit:** `test(GH05): add tests for session title generation`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
