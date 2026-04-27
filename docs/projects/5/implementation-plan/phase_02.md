# GH05: Auto-Generated Session Titles — Phase 2

**Goal:** Wire `maybeGenerateSessionTitle` into the agent loop and update callers (TUI, Discord) to pass `sessionId`.

**Architecture:** The call is fire-and-forget at the end of `_chatImpl`, after computing the result but before returning it. Callers pass `sessionId` through `ChatOptions` when they have a session context. Errors are swallowed to avoid blocking responses.

**Tech Stack:** TypeScript, Bun

**Scope:** 2 phases from design (phase 2 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH05.AC5: Non-blocking integration
- **GH05.AC5.1:** Non-blocking -- errors swallowed silently

### GH05.AC6: Caller wiring
- **GH05.AC6.1:** `sessionId` passed by TUI and Discord callers

---

<!-- START_TASK_1 -->
### Task 1: Wire maybeGenerateSessionTitle into agent loop

**Verifies:** GH05.AC5.1

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

Add the import at the top of `src/agent/agent.ts`:

```typescript
import { maybeGenerateSessionTitle } from './session-title.ts';
```

The current `_chatImpl` has three return points (lines 255, 257, 263) all inside a `try/finally`. To fire the title generation before returning without duplicating the call at each return site, refactor the return flow to compute the result into a variable, fire the title generation, then return.

Replace the section from line 255 to line 263 (the three return statements):

Current code (lines 255-263):
```typescript
    if (!lastAssistant) return { text: '', stats };

    if (typeof lastAssistant.content === 'string') return { text: lastAssistant.content, stats };

    const textBlocks = lastAssistant.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text);

    return { text: textBlocks.join('\n') || '', stats };
```

Replace with:
```typescript
    let resultText = '';
    if (!lastAssistant) {
      resultText = '';
    } else if (typeof lastAssistant.content === 'string') {
      resultText = lastAssistant.content;
    } else {
      resultText = lastAssistant.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n') || '';
    }

    const result: ChatResult = { text: resultText, stats };

    // Fire-and-forget title generation -- don't block the response
    maybeGenerateSessionTitle(deps.store, options?.sessionId, deps.subAgent, history)
      .catch(() => {});

    return result;
```

This preserves identical behavior for the return value while adding the non-blocking title generation call. The `.catch(() => {})` ensures unhandled rejection warnings don't surface.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All existing tests still pass (if any exist from Phase 1)

**Commit:** `feat(GH05): wire session title generation into agent loop`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Pass sessionId from Discord bot

**Verifies:** GH05.AC6.1

**Files:**
- Modify: `src/discord/bot.ts:189-193`

**Implementation:**

In `src/discord/bot.ts`, the `processMessage` function calls `agent.chat()` at line 189. The Discord bot already uses `channelId` as the session identifier (it calls `store.ensureSession(channelId)` at line 166). Add `sessionId` to the existing options.

Current code (lines 189-193):
```typescript
      const result = await agent.chat(processed, {
        context: { channelId },
        images,
        conversationOverride: history,
      });
```

Updated:
```typescript
      const result = await agent.chat(processed, {
        context: { channelId },
        images,
        conversationOverride: history,
        sessionId: channelId,
      });
```

No other changes needed. The `channelId` is already the session key used by `store.ensureSession()`, so it's the correct value to pass as `sessionId`.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(GH05): pass sessionId from Discord bot`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Pass sessionId from TUI (if session tracking is added)

**Verifies:** GH05.AC6.1

**Files:**
- Note: `src/tui/App.tsx` (no changes needed currently)

**Implementation:**

The TUI currently does NOT use session tracking. The `agent.chat(input)` call at `src/tui/App.tsx:99` passes no options at all. The TUI agent uses in-memory history only (see `src/index.ts:113` where `tuiAgent` is created without `conversationOverride`).

Since the TUI has no session ID to pass, no changes are needed here. The `sessionId` field on `ChatOptions` is optional, and `maybeGenerateSessionTitle` silently skips when `sessionId` is undefined (guard at line ~77 of `session-title.ts`).

When TUI session management is added in the future (#13 Multi-Screen TUI), the session ID should be passed through at that point.

**No code changes. No commit.**

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify full integration

**Verifies:** All GH05 acceptance criteria

**Files:** None (verification only)

**Verification:**

Run the full test suite to confirm everything works together:

Run: `bunx tsc --noEmit`
Expected: No type errors across the entire project

Run: `bun test`
Expected: All tests pass (session-title tests from Phase 1 + any others)

Run: `bun run build`
Expected: Build succeeds

**Commit:** No commit needed for verification-only task. If all checks pass, the feature is complete.

<!-- END_TASK_4 -->
