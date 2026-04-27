# GH02: Event Emission / Lifecycle Hooks — Phase 1

**Goal:** Define the event types and update ChatOptions so the agent loop can emit lifecycle events to callers.

**Architecture:** Add `AgentEventKind` (string literal union) and `AgentEvent` (readonly typed object) to the Functional Core types module. Extend `ChatOptions` with an optional `onEvent` callback. Update the barrel export to expose the new types.

**Tech Stack:** TypeScript (bun runtime, strict mode)

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements types only. Tests for event emission behaviour are in Phase 2.

### GH02.AC1: AgentEvent and AgentEventKind types exported
- **GH02.AC1.1 Success:** `AgentEventKind` is a string literal union of `'llm_start' | 'llm_done' | 'tool_start' | 'tool_done'`
- **GH02.AC1.2 Success:** `AgentEvent` is a readonly type with `kind: AgentEventKind` and `data: Record<string, unknown>`
- **GH02.AC1.3 Success:** Both types are re-exported from `src/agent/index.ts`

### GH02.AC2: onEvent callback on ChatOptions is optional
- **GH02.AC2.1 Success:** `ChatOptions.onEvent` is typed as `((event: AgentEvent) => Promise<void>) | undefined`
- **GH02.AC2.2 Success:** Existing callers that omit `onEvent` continue to compile with no changes

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add AgentEventKind and AgentEvent types

**Verifies:** GH02.AC1.1, GH02.AC1.2

**Files:**
- Modify: `src/agent/types.ts` (append after line 66, before the closing of `ChatOptions`)

**Implementation:**

Add the following types immediately before the `ChatOptions` type definition (before line 62):

```typescript
export type AgentEventKind = 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done';

export type AgentEvent = {
  readonly kind: AgentEventKind;
  readonly data: Record<string, unknown>;
};
```

These are pure type declarations. `AgentEventKind` is a string literal union (not an enum, per house style). `AgentEvent` uses `readonly` fields to match the project's immutability convention.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bunx tsc --noEmit`
Expected: No type errors (types are additive, no existing code is changed)

**Commit:** `feat(agent): add AgentEventKind and AgentEvent types`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add onEvent to ChatOptions

**Verifies:** GH02.AC2.1, GH02.AC2.2

**Files:**
- Modify: `src/agent/types.ts:62-66` (the `ChatOptions` type)

**Implementation:**

Update the `ChatOptions` type to include the optional `onEvent` callback:

```typescript
export type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
  readonly onEvent?: (event: AgentEvent) => Promise<void>;
};
```

The field is optional (`?:`) so all existing callers (`src/tui/App.tsx:99`, `src/discord/bot.ts:189`, `src/scheduler/scheduler.ts:207`) continue to work without changes.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bunx tsc --noEmit`
Expected: No type errors. Existing callers don't provide `onEvent` and compile cleanly.

**Commit:** `feat(agent): add optional onEvent callback to ChatOptions`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel export

**Verifies:** GH02.AC1.3

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add `AgentEvent` and `AgentEventKind` to the type re-export line. The current barrel export at `src/agent/index.ts` is:

```typescript
export type { Agent, AgentConfig, AgentDependencies, ConversationTurn } from './types.ts';
```

Update to:

```typescript
export type { Agent, AgentConfig, AgentDependencies, AgentEvent, AgentEventKind, ConversationTurn } from './types.ts';
```

Alphabetical order is maintained.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bunx tsc --noEmit`
Expected: No type errors.

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH02 && bun run build`
Expected: Build succeeds.

**Commit:** `feat(agent): export AgentEvent and AgentEventKind from barrel`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
