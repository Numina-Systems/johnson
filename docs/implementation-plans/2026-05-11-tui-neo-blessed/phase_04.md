# TUI Neo-Blessed Migration — Phase 4: Chat View

**Goal:** Build the critical chat interface — scrollable message history with syntax highlighting, plain text input, agent integration via `agent.chat()` with event-driven status updates, and auto-scroll behaviour.

**Architecture:** Chat view is a factory function returning `ScreenView` with three vertical zones: ScrollableViewer (message history), `blessed.textarea` (input), and StatusBar (agent status). Messages are formatted as blessed tagged strings with syntax highlighting via `highlightMarkdown()`. Agent integration uses the `ChatOptions.onEvent` callback for progressive status updates. Message persistence uses `store.appendMessage()` / `store.getMessages()`.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 4 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC1: All 7 screens render with equivalent functionality
- **tui-neo-blessed.AC1.2 Success:** Chat screen displays conversation history and accepts user input that dispatches to `agent.chat()`

### tui-neo-blessed.AC2: Scrollable everywhere
- **tui-neo-blessed.AC2.1 Success:** Chat message history scrolls with arrow keys and Page Up/Down
- **tui-neo-blessed.AC2.2 Success:** Chat message history scrolls with mouse wheel
- **tui-neo-blessed.AC2.4 Success:** Auto-scroll to bottom on new messages unless user has scrolled up manually

### tui-neo-blessed.AC3: Readable text
- **tui-neo-blessed.AC3.1 Success:** User, agent, and system messages are visually distinct via colour-coded role labels
- **tui-neo-blessed.AC3.2 Success:** Messages are separated by blank lines — no jumbling between adjacent messages
- **tui-neo-blessed.AC3.3 Success:** Agent responses with fenced code blocks display syntax-highlighted output

### tui-neo-blessed.AC6: Plain text input
- **tui-neo-blessed.AC6.1 Success:** Chat input box accepts and displays plain text without styling or ANSI codes

### tui-neo-blessed.AC4: Tab bar navigation
- **tui-neo-blessed.AC4.3 Failure:** Tab switching does not interrupt an in-progress `agent.chat()` call

### tui-neo-blessed.AC9: New features
- **tui-neo-blessed.AC9.1 Success:** Chat input supports multi-line via Shift+Enter (in Zellij locked mode)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create message formatting module (Functional Core)

**Verifies:** tui-neo-blessed.AC3.1, tui-neo-blessed.AC3.2, tui-neo-blessed.AC3.3

**Files:**
- Create: `src/tui/views/format.ts`

**Implementation:**

Mark as `// pattern: Functional Core` — pure functions with no side effects.

This module converts raw messages into blessed tagged strings for display. It handles role labelling, blank line separation, and syntax highlighting.

```typescript
import { palette, blessedStyles } from '../theme.ts';
import { highlightMarkdown } from '../syntax.ts';
```

Type definitions:

```typescript
type DisplayMessage = {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
};
```

Functions to implement:

**`formatMessage(msg: DisplayMessage): string`** — Formats a single message as a blessed tagged string. Use `blessedStyles` colours to match the existing theme (AC7.2):
- User: `{bold}{${blessedStyles.userMsg.fg}-fg}you>{/} ${msg.text}` (lavender)
- Agent: `{bold}{${blessedStyles.agentMsg.fg}-fg}agent>{/} ${highlightMarkdown(msg.text)}` (green)
- System: `{${blessedStyles.systemMsg.fg}-fg}[system] ${msg.text}{/}` (yellow)

Agent messages get syntax highlighting via `highlightMarkdown()`. User and system messages are plain text (no highlighting).

**`formatMessageHistory(messages: ReadonlyArray<DisplayMessage>): string`** — Joins all messages with double newline (`\n\n`) for blank line separation between messages. Returns the full content string for the ScrollableViewer.

**`mapStoreRole(role: string): 'user' | 'agent' | 'system'`** — Converts store role strings to display roles:
- `'assistant'` → `'agent'`
- `'user'` → `'user'`
- anything else → `'system'`

**Testing:**

Tests must verify:
- tui-neo-blessed.AC3.1: `formatMessage()` produces different output for user/agent/system roles, each with distinct colour tags
- tui-neo-blessed.AC3.2: `formatMessageHistory()` separates messages with blank lines (`\n\n`)
- tui-neo-blessed.AC3.3: Agent messages pass through `highlightMarkdown()` — verify that fenced code blocks in agent text produce highlighted output (the existing `highlightMarkdown` already handles this; test that `formatMessage` calls it for agent role)
- `mapStoreRole()` correctly maps 'assistant' → 'agent' and handles unknown roles

Test file: `src/tui/views/format.test.ts`

**Verification:**

Run: `bun test src/tui/views/format.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add message formatting module for chat display`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create chat view

**Verifies:** tui-neo-blessed.AC1.2, tui-neo-blessed.AC2.1, tui-neo-blessed.AC2.2, tui-neo-blessed.AC2.4, tui-neo-blessed.AC6.1, tui-neo-blessed.AC9.1

**Files:**
- Create: `src/tui/views/chat.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

Create a factory function that builds the Chat view with three vertical zones.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { EventEmitter } from 'events';
import type { Agent, ChatOptions } from '../../agent/types.ts';
import type { Store } from '../../store/store.ts';
import type { ScreenView, TuiEvents } from '../types.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { formatMessage, formatMessageHistory, mapStoreRole } from './format.ts';
import type { DisplayMessage } from './format.ts';
```

Type for the factory options:

```typescript
type ChatViewOptions = {
  readonly screen: Widgets.Screen;
  readonly agent: Agent;
  readonly store: Store;
  readonly bus: EventEmitter;
};
```

The `createChatView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **Message history zone:** Use `createScrollableViewer` positioned inside the container at `top: 0, width: '100%', bottom: 3` (leaving room for input + status bar). This is the scrollable chat log.

3. **Input zone:** `blessed.textarea` positioned at `bottom: 1, left: 0, width: '100%', height: 1`.
   - `inputOnFocus: true` — starts accepting input when focused
   - `keys: true`
   - `mouse: true`
   - **Plain text only** — no `tags: true` on the textarea (avoids neo-blessed cursor bugs with styled text). Satisfies AC6.1.
   - `style` using `palette.surface0` for bg, `blessedStyles.text` for fg
   - Border: a simple top border line or visual separator to distinguish from history

4. **Status bar zone:** `createStatusBar` at the bottom of the container. Shows "Ready", "Thinking...", "Round N complete", "Running code...", etc.

5. **Internal state:**
   - `messages: Array<DisplayMessage>` — the display message list
   - `currentSessionId: string | null` — set when `session:selected` fires
   - `isThinking: boolean` — prevents input during agent processing
   - `isCapturingInput: boolean` — true when textarea is focused (always true for chat view when visible, to prevent `q` from quitting while typing)

6. **Session loading:** When `session:selected` fires on the bus:
   - Set `currentSessionId`
   - Load existing messages via `store.getMessages(sessionId, 200)`
   - Map each stored message to `DisplayMessage` using `mapStoreRole()`
   - Format and set as history content via `formatMessageHistory()`
   - Scroll to bottom

7. **Input handling:**
   - **Enter** (submit): Get `textarea.getValue()`, trim, validate non-empty. If valid:
     1. Clear the textarea
     2. Add user message to `messages` array
     3. Persist: `store.appendMessage(sessionId, 'user', text)`
     4. Update history display, auto-scroll to bottom
     5. Set `isThinking = true`, update status to "Thinking..."
     6. Call `agent.chat(text, chatOptions)` with event handler (see below)
     7. On completion: add agent response to messages, persist, update display, set `isThinking = false`, status "Ready"
     8. On error: add system error message, set `isThinking = false`, status "Error"
   - **Shift+Enter** (multi-line): Insert a newline into the textarea content. This requires Zellij locked mode (`Ctrl+G`) — satisfies AC9.1.
   - **Escape** (when not thinking): Could navigate back to Sessions, handled by index.ts

8. **Agent event handling** via `ChatOptions.onEvent`:
   ```typescript
   const chatOptions: ChatOptions = {
     sessionId: currentSessionId,
     onEvent: async (event) => {
       switch (event.kind) {
         case 'llm_start':
           statusBar.setText('Thinking...');
           break;
         case 'llm_done': {
           const round = event.data['round'];
           statusBar.setText(typeof round === 'number' ? `Round ${round} complete` : 'Round complete');
           break;
         }
         case 'tool_start':
           statusBar.setText('Running code...');
           break;
         case 'tool_done': {
           const success = event.data['success'];
           statusBar.setText(success === false ? 'Code error' : 'Code finished');
           break;
         }
       }
       screen.render();
     },
   };
   ```

9. **Command handling** (check input text before sending to agent):
   - `/reset` — call `agent.reset()`, clear messages array, show system message "History cleared", update display
   - `/help` — show system message with available commands
   - `/quit` or `/exit` — `process.exit(0)`

10. **Auto-scroll:** Use ScrollableViewer's built-in auto-scroll from Phase 2. When appending messages, call `appendContent()` which auto-scrolls if user is at bottom.

11. **Focus management:** When the view is shown, focus the textarea so the user can type immediately. When a history scroll key is pressed (Page Up/Down while not in textarea), shift focus to the history viewer temporarily.

12. **Tab switching safety (AC4.3):** The chat view uses `show()`/`hide()` for visibility toggling — this does NOT destroy the view or cancel the `agent.chat()` promise. When the user switches tabs while `agent.chat()` is in progress:
    - The `agent.chat()` promise continues executing in the background
    - The `onEvent` callback continues updating internal state (message history, status) even while the view is hidden
    - When the agent finishes, the response is appended to the messages array and persisted to the store regardless of visibility
    - The `tab:activity` event fires on the bus so the tab bar shows `*` on the Chat tab
    - When the user returns to the Chat tab, `show()` re-renders the current state (including any messages added while hidden)
    - Key invariant: `hide()` only sets `container.hidden = true` — it must NOT call `agent.reset()`, clear messages, or cancel any in-flight operation

13. **Return ScreenView:**
    ```typescript
    return {
      name: 'Chat',
      container,
      get isCapturingInput() { return true; },
      show() { container.show(); loadSession(); textarea.focus(); screen.render(); },
      hide() { container.hide(); screen.render(); },
      focus() { textarea.focus(); },
      destroy() { container.destroy(); },
    };
    ```

    Note: `isCapturingInput` is always `true` for the Chat view — this prevents single-letter keybindings (`q`, `n`, `d`, etc.) from firing while the user is typing.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.2: Chat view loads messages from store and displays them; submitting input calls `agent.chat()`
- tui-neo-blessed.AC2.4: Auto-scroll to bottom on new messages (test via ScrollableViewer's `isScrolledToBottom()` integration)
- tui-neo-blessed.AC6.1: Input textarea does not have `tags: true` (plain text only)
- tui-neo-blessed.AC9.1: Multi-line input is supported (Shift+Enter inserts newline)
- Status transitions: llm_start → "Thinking...", tool_start → "Running code...", completion → "Ready"
- tui-neo-blessed.AC4.3: Verify that calling `hide()` on the chat view does NOT cancel an in-progress `agent.chat()` call — mock agent.chat() with a delayed resolution, call hide() during the delay, verify the promise still resolves and the response is appended to messages
- Command handling: `/reset` clears history, `/help` shows help

Test with mock Agent and mock Store using the project's partial mock pattern.

Test file: `src/tui/views/chat.test.ts`

**Verification:**

Run: `bun test src/tui/views/chat.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add chat view with message history, input, and agent integration`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire chat view into index.ts

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

1. Import `createChatView` from `./views/chat.ts`

2. Create the Chat view in `startTUI`:
   ```typescript
   const chatView = createChatView({
     screen,
     agent: deps.agent,
     store: deps.store,
     bus,
   });
   ```

3. Replace the `null` at index 1 in the views array with `chatView`.

4. Update the Sessions view's `onSelectSession` callback to:
   - Emit `session:selected` on the bus with the session ID
   - Switch to the Chat tab (index 1)

5. Handle Escape key in Chat view — when Escape is pressed and chat is not thinking, switch back to Sessions tab (index 0).

**Step 2: Verify operationally**

Run: `bun start`
Expected: Select a session from Sessions → Chat view opens with message history loaded. Type a message → agent responds → response displayed with syntax highlighting. Status bar updates during agent processing. Auto-scroll works. Tab/Shift+Tab switches between tabs. Escape returns to Sessions.

**Step 3: Verify build**

Run: `bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): wire chat view into neo-blessed entry point"
```
<!-- END_TASK_3 -->
