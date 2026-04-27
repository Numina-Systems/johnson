# GH13: Multi-Screen TUI — Phase 3: Chat Screen

**Goal:** Extract the chat UI from `App.tsx` into a standalone `ChatScreen` component, add event-driven status indicators from #2's event system, and wire session persistence.

**Architecture:** The chat screen is extracted as `src/tui/screens/ChatScreen.tsx`. It receives the agent, session ID, and store as props. Messages are loaded from the store on mount (for existing sessions) and persisted after each exchange. The `onEvent` callback from #2 drives real-time status indicators (thinking spinner, running code indicator, token stats).

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 3 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC3: Chat screen shows real-time event indicators (thinking, running, token stats)
- **GH13.AC3.1:** `llm_start` event shows "Thinking..." spinner
- **GH13.AC3.2:** `tool_start` event shows "Running code..." with tool name
- **GH13.AC3.3:** `llm_done` event updates token stats bar
- **GH13.AC3.4:** Token stats bar displays input/output tokens, rounds, duration after response completes

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tui/screens/ChatScreen.tsx`

**Verifies:** GH13.AC3.1, GH13.AC3.2, GH13.AC3.3, GH13.AC3.4

**Files:**
- Create: `src/tui/screens/ChatScreen.tsx`

**Implementation:**

Extract the chat functionality from `App.tsx` into its own component. The core logic is identical to the current chat page in `App.tsx`, with these additions:

**Props:**

```typescript
type ChatScreenProps = {
  readonly agent: Agent;
  readonly store: Store;
  readonly sessionId: string;
  readonly onBack: () => void;
};
```

**Event-driven status indicators:**

The chat screen passes an `onEvent` callback when calling `agent.chat()`. This requires #2's event system to be merged (the `onEvent` field on `ChatOptions`).

```typescript
const handleSubmit = useCallback(async (value: string) => {
  // ... existing validation ...

  setIsThinking(true);
  setStatus('Thinking...');

  try {
    const result = await agent.chat(input, {
      onEvent: async (event) => {
        switch (event.kind) {
          case 'llm_start':
            setStatus('Thinking...');
            break;
          case 'llm_done':
            // Briefly show token info from this round
            setStatus(`Round ${event.data.round} complete`);
            break;
          case 'tool_start':
            setStatus(`Running code...`);
            break;
          case 'tool_done':
            setStatus(event.data.success ? 'Code finished' : 'Code error');
            break;
        }
      },
    });
    // ... handle result ...
  } catch (error) {
    // ... handle error ...
  }
}, [agent, isThinking, sessionId, store]);
```

If #2 is not merged yet, the `onEvent` property simply won't exist on `ChatOptions` and the compiler will flag it. The fallback is to remove the `onEvent` parameter — the basic "Thinking..." status from `setIsThinking` still works.

**Session persistence:**

On mount, load existing messages from the store:

```typescript
useEffect(() => {
  const stored = store.getMessages(sessionId, 200);
  const loaded: Message[] = stored.map(m => ({
    role: m.role as 'user' | 'agent' | 'system',
    text: m.content,
  }));
  setMessages(loaded);
}, [sessionId, store]);
```

After each successful exchange, persist messages:

```typescript
// After adding user message to display
store.appendMessage(sessionId, 'user', input);

// After receiving agent response
store.appendMessage(sessionId, 'assistant', result.text);
```

**Key bindings:**

The chat screen's `useInput` handles:
- `Ctrl+C` — quit
- `Escape` — call `onBack()` (only when not in the middle of thinking)

The text input captures all other keys. Global nav keys (`t`, `s`, etc.) are handled by the parent `App.tsx` shell, which disables them when `currentScreen === 'chat'` and not thinking.

**Commands:**

- `/reset` — resets the agent and clears display messages
- `/help` — shows available commands and navigation keys
- `/quit` — exits
- Remove `/review` (replaced by tools screen via `t` key)

**Token stats bar:**

After a response, `formatStats(result.stats)` is displayed in the status bar (same as current behaviour, using the existing `formatStats` from `src/agent/format-stats.ts`).

Pattern comment: `// pattern: UI Shell — chat interface with event-driven status`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): extract ChatScreen with event-driven status indicators`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire ChatScreen into App.tsx and clean up

**Files:**
- Modify: `src/tui/App.tsx` — remove inline chat code, render `ChatScreen` in the switch

**Implementation:**

Replace the inline chat JSX and state in `App.tsx` with a `ChatScreen` render:

```typescript
case 'chat':
  if (!activeSessionId) {
    // Shouldn't happen, but handle gracefully
    pop();
    return <Text>No session selected</Text>;
  }
  return (
    <ChatScreen
      agent={deps.agent}
      store={deps.store}
      sessionId={activeSessionId}
      onBack={pop}
    />
  );
```

Remove from `App.tsx`:
- `messages`, `isThinking`, `status`, `inputValue` state declarations
- `handleSubmit` callback
- The log subscription `useEffect` (move it into `ChatScreen`)
- All the chat-related JSX
- The `ReviewPage` import and its render branch (replaced by tools screen)
- The `import TextInput from 'ink-text-input'` (moves to ChatScreen)
- The `import Spinner from 'ink-spinner'` (moves to ChatScreen)
- The `formatStats` import (moves to ChatScreen)

After this, `App.tsx` should be a thin shell: screen stack state, navigation callbacks, global `useInput`, and a `switch` statement. Approximately 50-70 lines.

Update the global nav `useInput` logic. Since `ChatScreen` now fully owns its own input handling, the global nav should be active when `currentScreen !== 'chat'`:

```typescript
const globalNavActive = currentScreen !== 'chat';
useInput((input, key) => {
  if (input === 't') push('tools');
  if (input === 's') push('secrets');
  if (input === 'c') push('schedules');
  if (input === 'p') push('prompt');
  if (input === 'q') { exit(); process.exit(0); }
  if (key.escape) pop();
}, { isActive: globalNavActive });
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `refactor(tui): remove inline chat from App.tsx, delegate to ChatScreen`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Remove `src/tui/ReviewPage.tsx`

**Files:**
- Delete: `src/tui/ReviewPage.tsx`
- Modify: `src/tui/App.tsx` — remove any remaining import of ReviewPage (should already be gone from Task 2)

**Implementation:**

The `ReviewPage` is being absorbed into the Tools screen (Phase 4). Delete the file entirely. Verify no remaining imports reference it.

```bash
grep -rn "ReviewPage" src/tui/
```

Should return nothing after this task.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && grep -rn "ReviewPage" src/tui/`
Expected: No output

**Commit:** `refactor(tui): remove ReviewPage (absorbed into ToolsScreen)`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
