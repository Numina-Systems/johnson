# Human Test Plan: TUI Neo-Blessed Migration

## Prerequisites

- Terminal with true-colour support (e.g., Alacritty, Kitty, WezTerm, Ghostty)
- Zellij installed and available
- Project dependencies installed: `bun install`
- All automated tests passing: `bun test` (expect 137 pass, 0 fail in src/tui/)
- A valid `config.toml` with at minimum `[model]` configured

## Phase 1: Visual Rendering and Theme

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Run `bun start` in a true-colour terminal | TUI launches. Background colour is Catppuccin Macchiato base (#24273a). No crash, no ANSI garbage. |
| 1.2 | Observe the tab bar at top of screen | A single-line tab bar is visible at row 0 with 7 labels: Sessions, Chat, Tools, Secrets, Schedules, Prompt, Prune. "Sessions" is highlighted with mauve accent colour (#c6a0f6). |
| 1.3 | Press Tab 6 times to cycle through all tabs | Each tab becomes highlighted as active. The tab bar remains visible on every screen. |
| 1.4 | Press Shift+Tab to cycle backwards | Tabs cycle in reverse. Wraps from Sessions back to Prune. |
| 1.5 | Visually compare colours to Catppuccin Macchiato palette | Background is base (#24273a), tab bar background is mantle (#1e2030) or crust (#181926), text is text (#cad3f5), muted text is overlay0 (#6e738d), active tab accent is mauve (#c6a0f6), user messages are lavender (#b7bdf8), agent messages are green (#a6da95), system messages are yellow (#eed49f). |

## Phase 2: Chat Functionality

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Navigate to Sessions tab, press `n` to create a new session | A new session appears in the list with "Untitled session" label. |
| 2.2 | Press Enter to select the new session | View switches to Chat tab. Input textarea is focused at bottom. Status bar shows "Ready". |
| 2.3 | Type "Hello, what is 2+2?" and press Enter | User message appears with lavender "you>" prefix. Status bar transitions to "Thinking..." then "Ready". Agent response appears with green "agent>" prefix. |
| 2.4 | Send a message that elicits a code block response | Agent response contains a fenced code block with syntax highlighting. |
| 2.5 | Send enough messages to exceed the viewport height | Messages scroll. Use arrow keys and Page Up/Page Down to scroll through history. |
| 2.6 | Scroll to the top of chat history, then send a new message | Scroll position is preserved (does not jump to bottom). |
| 2.7 | Press `g` to scroll to top, then `G` to scroll to bottom | `g` jumps to the very first message. `G` jumps to the very last message. |
| 2.8 | Type `/reset` and press Enter | Chat history is cleared. No message is sent to the agent. |
| 2.9 | Type `/help` and press Enter | Help text appears as a system message with yellow "[system]" prefix. |
| 2.10 | Press F5 | A search overlay appears. Type a word that exists in the chat history. The view scrolls to the first matching message. |
| 2.11 | Press Escape to dismiss search | Search overlay closes. Normal chat input is restored. |

## Phase 3: Mouse Scroll Verification

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | In the Chat tab with scrollable history, use mouse wheel to scroll up | Chat history scrolls upward. |
| 3.2 | Use mouse wheel to scroll down | Chat history scrolls downward. |
| 3.3 | Navigate to any list screen with many items, use mouse wheel | List scrolls with mouse wheel. |

## Phase 4: Tab Navigation Resilience

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | In the Chat tab, send a message to the agent | While the agent is processing ("Thinking..."), press Tab to switch to another tab. |
| 4.2 | Wait for the agent to finish, then switch back to Chat | The agent's response is present in the chat history. No error occurred. |
| 4.3 | Press `q` while no confirmation dialog is active | The TUI exits cleanly. |

## Phase 5: Zellij Compatibility

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Open a Zellij session. Run `bun start` inside a Zellij pane. | TUI launches without rendering artefacts. |
| 5.2 | Press Tab / Shift+Tab | Tab cycling works. Zellij does not intercept these keys. |
| 5.3 | Navigate lists with arrow keys, select with Enter, go back with Escape | All navigation works without Zellij interception. |
| 5.4 | Use Page Up/Page Down in a scrollable view | Scrolling works. |
| 5.5 | Press Space in the Prune screen to toggle checkboxes | Checkboxes toggle. |
| 5.6 | Test single-letter actions: `n`, `d`, `e`, `v`, `s`, `g`/`G` | All single-letter actions work without Zellij interception. |
| 5.7 | Enter Zellij locked mode (`Ctrl+G`). In Chat input, type text, press Shift+Enter, type more text. | A newline is inserted (multi-line). Message is NOT submitted on Shift+Enter. |
| 5.8 | Press Enter (not Shift+Enter) to submit the multi-line message | The full multi-line message is submitted. |
| 5.9 | Run `grep -rn "'C-\|'M-" src/tui/ --include="*.ts"` | Only one result: `src/tui/index.ts` with `'C-c'`. |

## Phase 6: Tools, Secrets, Schedules Screens

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Navigate to Tools tab | Three sections visible. Section header indicates which is active. |
| 6.2 | Press Left/Right arrow keys | Cycles between the three sections. Wraps from Skills back to Custom. |
| 6.3 | If skills exist, highlight one and press `v` | Code viewer overlay appears. Press Escape to close. |
| 6.4 | Navigate to Secrets tab | Secret names are listed. Values are NEVER displayed. |
| 6.5 | Press `a` to add a new secret | Prompted for name, then value (masked). After completion, secret appears in the list. |
| 6.6 | Highlight a secret and press `d` | Confirmation dialog appears. Press `y` to confirm or `n` to cancel. |
| 6.7 | Navigate to Schedules tab | Tasks listed with enabled/disabled indicators, cron expression, run count, and last run info. |
| 6.8 | Highlight a task and press `e` | Task toggles enabled/disabled state. |

## Phase 7: Prune Screen

| Step | Action | Expected |
|------|--------|----------|
| 7.1 | Navigate to Prune tab | Sessions listed with checkboxes, classification labels, message counts, and timestamps. |
| 7.2 | Press Space on individual sessions | Checkbox toggles. |
| 7.3 | Press `a` to select all stale sessions | All delete/archive sessions become selected. Active sessions remain unselected. |
| 7.4 | Press Enter with selections | Confirmation dialog appears showing breakdown. |
| 7.5 | Press `y` to confirm | Empty sessions deleted, sessions with messages archived. Result summary shows counts. |

## Phase 8: System Prompt Screen

| Step | Action | Expected |
|------|--------|----------|
| 8.1 | Navigate to Prompt tab | System prompt text loads and displays. |
| 8.2 | Scroll through the prompt with arrow keys and Page Up/Down | Content scrolls. Full system prompt is visible. |

## Phase 9: External Contract

| Step | Action | Expected |
|------|--------|----------|
| 9.1 | Run `bun run build` | Build completes successfully with no errors. |
| 9.2 | Run `bun start` | TUI launches and is fully functional. |
| 9.3 | Inspect `src/index.ts` | Contains `import { startTUI } from './tui/index.ts'` unchanged. |

## End-to-End: Full Session Lifecycle

1. Launch `bun start`.
2. In Sessions, press `n` to create a new session.
3. Press Enter to open it in Chat.
4. Send 2-3 messages. Verify formatting (role labels, colours, blank line separation).
5. Press Tab to switch to Tools tab.
6. Press Shift+Tab to return to Chat. Verify conversation is intact.
7. Navigate to Prune tab. The session should appear classified as "active" (green).
8. Create another empty session. Navigate to Prune. After 24h the empty session would be classified as "delete" (red).

## End-to-End: Zellij Multi-Pane Workflow

1. Open Zellij. Create two panes side by side.
2. Run `bun start` in the left pane.
3. Navigate through all 7 tabs. Verify Zellij does not intercept.
4. Switch between panes using Zellij's Alt+arrow keys. Verify TUI resumes correctly.
5. Enter Zellij locked mode (`Ctrl+G`) while in Chat. Verify Shift+Enter inserts newlines.

## AC Coverage Traceability

| AC | Automated Test | Manual Step |
|----|----------------|-------------|
| AC1.1 | `views/sessions.test.ts` | 2.1 |
| AC1.2 | `views/chat.test.ts` | 2.3-2.4 |
| AC1.3 | `views/tools.test.ts` | 6.1-6.3 |
| AC1.4 | `views/secrets.test.ts` | 6.4-6.6 |
| AC1.5 | `views/schedules.test.ts` | 6.7-6.8 |
| AC1.6 | `views/system-prompt.test.ts` | 8.1-8.2 |
| AC1.7 | `views/prune.test.ts` | 7.1-7.5 |
| AC2.1 | `widgets/scrollable-viewer.test.ts` | 2.5 |
| AC2.2 | `widgets/scrollable-viewer.test.ts` (partial) | 3.1-3.3 |
| AC2.3 | `widgets/selectable-list.test.ts` | 3.3 |
| AC2.4 | `widgets/scroll-utils.test.ts` | 2.6 |
| AC3.1 | `views/format.test.ts` | 2.3 |
| AC3.2 | `views/format.test.ts` | 2.3 |
| AC3.3 | `views/format.test.ts` | 2.4 |
| AC4.1 | -- | 1.2-1.4 |
| AC4.2 | `tab-bar.test.ts` | 1.3-1.4 |
| AC4.3 | `views/chat.test.ts` | 4.1-4.2 |
| AC5.1 | `widgets/*.test.ts` (partial) | 5.1-5.6 |
| AC5.2 | grep audit | 5.9 |
| AC6.1 | `views/chat.test.ts` | 2.3 |
| AC7.1 | -- | 1.5 |
| AC7.2 | `views/format.test.ts` (partial) | 1.5 |
| AC8.1 | Pure function tests | Code review |
| AC8.2 | -- | `grep "// pattern:" src/tui/` |
| AC9.1 | `views/chat.test.ts` (partial) | 5.7-5.8 |
| AC9.2 | `views/chat.test.ts` | 2.10-2.11 |
| AC9.3 | Deferred | Deferred |
| AC10.1 | grep + build | 9.1-9.3 |
