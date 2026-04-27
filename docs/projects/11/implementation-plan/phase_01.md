# GH11: Extended Thinking / Reasoning Content Preservation — Phase 1

**Goal:** Add the `reasoning_content` optional field to `ModelResponse` and `Message` types so providers can surface reasoning and the agent loop can propagate it.

**Architecture:** A single optional string field on both the response type (provider output) and the message type (conversation history). Consumers that don't care about reasoning ignore the field. No schema migrations needed — messages are serialized as JSON strings in SQLite and the field survives naturally.

**Tech Stack:** TypeScript strict mode, Bun runtime

**Scope:** 3 phases total (this is phase 1 of 3)

**Codebase verified:** 2026-04-27 via direct investigation

---

## Acceptance Criteria Coverage

This phase implements:

### GH11.AC1: ModelResponse has optional reasoning_content field
- **GH11.AC1.1 Success:** `ModelResponse` type includes `reasoning_content?: string`

### GH11.AC2: Message has optional reasoning_content field
- **GH11.AC2.1 Success:** `Message` type includes `reasoning_content?: string`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `reasoning_content` to `ModelResponse`

**Verifies:** GH11.AC1.1

**Files:**
- Modify: `src/model/types.ts:59-63`

**Implementation:**

Add `reasoning_content?: string` to the `ModelResponse` type. This is the provider-facing output — each provider sets it when reasoning content is present in the API response.

In `src/model/types.ts`, the current `ModelResponse` type (lines 59-63) is:

```typescript
export type ModelResponse = {
  content: Array<ContentBlock>;
  stop_reason: StopReason;
  usage: UsageStats;
};
```

Add the field:

```typescript
export type ModelResponse = {
  content: Array<ContentBlock>;
  stop_reason: StopReason;
  usage: UsageStats;
  reasoning_content?: string;
};
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors. The field is optional so all existing provider return sites remain valid.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `reasoning_content` to `Message`

**Verifies:** GH11.AC2.1

**Files:**
- Modify: `src/model/types.ts:35-38`

**Implementation:**

Add `reasoning_content?: string` to the `Message` type. This is the conversation history type — the agent loop attaches reasoning content to assistant messages so it persists across the session.

The current `Message` type (lines 35-38) is:

```typescript
export type Message = {
  role: 'user' | 'assistant';
  content: string | Array<ContentBlock>;
};
```

Add the field:

```typescript
export type Message = {
  role: 'user' | 'assistant';
  content: string | Array<ContentBlock>;
  reasoning_content?: string;
};
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors. All existing message construction sites pass because the field is optional.

**Commit:** `feat(types): add reasoning_content field to ModelResponse and Message`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
