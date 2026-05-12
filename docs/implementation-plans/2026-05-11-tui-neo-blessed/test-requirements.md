# Test Requirements Matrix — TUI Neo-Blessed Migration

Maps every acceptance criterion from the design (`2026-05-11-tui-neo-blessed.md`) to either an automated test or a documented human verification procedure. Rationalized against the implementation plan decisions in phases 1-8.

---

## AC1: All 7 screens render with equivalent functionality

### tui-neo-blessed.AC1.1 — Sessions screen lists sessions with title, message count, and last activity timestamp

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/sessions.test.ts`
- **Phase:** 3
- **What the test verifies:**
  - `formatSessionLine()` pure function produces a blessed tagged string containing the session title, message count, and a formatted timestamp.
  - Handles null titles (renders "Untitled session").
  - Integration: mock `Store.listSessionsWithCounts()` returns known data; after `show()`, the list is populated with correctly formatted items.
  - Select event calls `onSelectSession` with the correct session ID.
  - `n` triggers session creation via `store.createSession()`.
  - `d` triggers deletion with confirmation flow via `store.deleteSession()`.

### tui-neo-blessed.AC1.2 — Chat screen displays conversation history and accepts user input that dispatches to `agent.chat()`

- **Verification:** Automated test (unit + integration)
- **Test file:** `src/tui/views/chat.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - Chat view loads messages from `store.getMessages()` on `session:selected` event and displays them via `formatMessageHistory()`.
  - Submitting input calls `agent.chat()` with the entered text.
  - Agent response is appended to the message history and persisted via `store.appendMessage()`.
  - Status bar transitions through "Thinking...", "Running code...", "Ready" based on `onEvent` callbacks.
  - Command handling: `/reset` clears history, `/help` shows help text.

### tui-neo-blessed.AC1.3 — Tools screen displays three sections (Custom, Built-in, Skills) with code viewing and secret assignment

- **Verification:** Automated test (unit + integration)
- **Test file:** `src/tui/views/tools.test.ts`
- **Phase:** 5
- **What the test verifies:**
  - Three sections exist (custom, builtin, skills).
  - Left/Right arrow cycling wraps correctly (0 -> 2 -> 0).
  - Grant icon formatting returns correct icons for each status (`granted`/`pending`/`revoked`).
  - `v` shows code viewer overlay with `highlightCode()` output; Escape closes it.
  - `s` shows secret assignment checkbox list; updates call `store.updateGrantSecrets()` or `customTools.updateSecrets()`.
  - `parseDescription()` extracts skill descriptions correctly.
  - Mock Store, SecretManager, and CustomToolManager used via partial mock pattern.

### tui-neo-blessed.AC1.4 — Secrets screen lists secret names, supports add/delete, and assigns secrets to skills

- **Verification:** Automated test (unit + integration)
- **Test file:** `src/tui/views/secrets.test.ts`
- **Phase:** 5
- **What the test verifies:**
  - List shows secret names (never values).
  - Mode transitions: list -> add_name -> add_value -> list.
  - Add flow: completing both inputs calls `secrets.set(name, value)`.
  - Delete flow: `y` confirmation calls `secrets.remove(name)`; `n` cancels.
  - Skill assignment: checkbox toggling updates grant/tool secrets via correct store methods.
  - Mock SecretManager, Store, CustomToolManager.

### tui-neo-blessed.AC1.5 — Schedules screen lists tasks with cron expression, run count, and enabled toggle

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/schedules.test.ts`
- **Phase:** 5
- **What the test verifies:**
  - `formatTaskLine()` pure function produces correct output:
    - Enabled task shows green bullet.
    - Disabled task shows dim bullet.
    - Task with last run shows formatted date, OK/FAIL status, duration.
    - Task without last run shows "Never run".
  - `e` key calls `scheduler.setEnabled(id, !current)` and refreshes.
  - Mock TaskStore.

### tui-neo-blessed.AC1.6 — SystemPrompt screen displays the current system prompt in a scrollable viewer

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/system-prompt.test.ts`
- **Phase:** 6
- **What the test verifies:**
  - `show()` calls `getSystemPrompt()` callback.
  - Returned prompt text is set as the ScrollableViewer content.
  - Mock `getSystemPrompt` returning a known string.

### tui-neo-blessed.AC1.7 — Prune screen shows sessions with checkboxes, classifies selections, and executes archive/delete

- **Verification:** Automated test (unit + integration)
- **Test file:** `src/tui/views/prune.test.ts`
- **Phase:** 6
- **What the test verifies:**
  - `formatPruneLine()` pure function: selected vs unselected shows different checkbox; classification determines colour tag.
  - Space toggles checkbox (adds/removes session ID from selected set).
  - `a` selects all stale sessions (classifications `delete` and `archive`).
  - Execution: empty sessions (messageCount === 0) call `store.deleteSession()`; sessions with messages call `archiveSession(id, store)` (without subAgent -- intentional degradation).
  - Confirmation dialog shows correct classification breakdown counts.
  - Result summary shows correct archived/deleted counts.
  - Mock Store.

---

## AC2: Scrollable everywhere

### tui-neo-blessed.AC2.1 — Chat message history scrolls with arrow keys and Page Up/Down

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/widgets/scrollable-viewer.test.ts`
- **Phase:** 2
- **What the test verifies:**
  - Scroll position changes after programmatic simulation of arrow key / Page Up / Page Down events.
  - `keys: true` is set on the blessed element.
  - Only arrow keys, Page Up/Down, g/G are bound -- no Ctrl/Alt bindings.

### tui-neo-blessed.AC2.2 — Chat message history scrolls with mouse wheel

- **Verification:** Automated test (unit) + Human verification
- **Test file:** `src/tui/widgets/scrollable-viewer.test.ts`
- **Phase:** 2
- **Automated portion:** `mouse: true` is set on the blessed element configuration.
- **Human verification:** Launch `bun start`, scroll chat history with mouse wheel. Confirm content scrolls. Actual mouse wheel behaviour depends on the terminal emulator and blessed's internal event handling.

### tui-neo-blessed.AC2.3 — List screens scroll when content exceeds viewport

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/widgets/selectable-list.test.ts`
- **Phase:** 2
- **What the test verifies:**
  - `scrollable: true` is set on the blessed list element.
  - When many items are set, `getScrollHeight() > height` (programmatic verification).
  - `keys: true` and `mouse: true` are set (enabling built-in scroll).

### tui-neo-blessed.AC2.4 — Auto-scroll to bottom on new messages unless user has scrolled up manually

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/widgets/scrollable-viewer.test.ts` and `src/tui/views/chat.test.ts`
- **Phase:** 2 (widget) + 4 (chat integration)
- **What the test verifies:**
  - Pure helper `isAtBottom(scrollPos, scrollHeight, viewHeight)` returns correct boolean with tolerance.
  - `appendContent()` auto-scrolls when `isScrolledToBottom()` is true.
  - `appendContent()` does NOT auto-scroll when user has scrolled up.
  - Chat view integration: new agent messages auto-scroll history to bottom when user is at bottom; preserve scroll position when user has scrolled up.

---

## AC3: Readable text

### tui-neo-blessed.AC3.1 — User, agent, and system messages are visually distinct via colour-coded role labels

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/format.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - `formatMessage()` produces different blessed tagged strings for user/agent/system roles.
  - User messages contain the lavender colour tag and "you>" prefix.
  - Agent messages contain the green colour tag and "agent>" prefix.
  - System messages contain the yellow colour tag and "[system]" prefix.

### tui-neo-blessed.AC3.2 — Messages are separated by blank lines

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/format.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - `formatMessageHistory()` joins messages with `\n\n` (double newline).
  - Adjacent messages in the output string are separated by blank lines.

### tui-neo-blessed.AC3.3 — Agent responses with fenced code blocks display syntax-highlighted output

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/format.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - `formatMessage()` calls `highlightMarkdown()` for agent-role messages.
  - Agent messages containing fenced code blocks produce output with ANSI escape codes (syntax highlighting).
  - User and system messages do NOT pass through `highlightMarkdown()`.

---

## AC4: Tab bar navigation

### tui-neo-blessed.AC4.1 — Tab bar is visible at top of every screen showing all 7 tab labels

- **Verification:** Human verification
- **Phase:** 1 (created), 3 (wired)
- **Justification:** Tab bar visibility is a rendering property of the blessed screen. Verifying that a `blessed.box` at `top: 0, height: 1` with specific content is visually rendered correctly requires a terminal and human eyeballs.
- **Verification approach:** Launch `bun start`. Navigate to each of the 7 tabs via Tab/Shift+Tab. Confirm the tab bar is visible at the top of every screen with all 7 labels (Sessions, Chat, Tools, Secrets, Schedules, Prompt, Prune). Confirm the active tab is highlighted with the accent colour.

### tui-neo-blessed.AC4.2 — Tab/Shift+Tab cycles between tabs in order, wrapping at ends

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/tab-bar.test.ts`
- **Phase:** 7
- **What the test verifies:**
  - `nextTab(current, total)` pure function: `nextTab(6, 7) === 0` (wraps forward).
  - `prevTab(current, total)` pure function: `prevTab(0, 7) === 6` (wraps backward).
  - `nextTab(3, 7) === 4` (normal forward).
  - `prevTab(3, 7) === 2` (normal backward).
  - Activity indicator lifecycle: set when event fires for non-active tab, cleared when tab is visited, not set for the currently active tab.

### tui-neo-blessed.AC4.3 — Tab switching does not interrupt an in-progress `agent.chat()` call

- **Verification:** Automated test (integration)
- **Test file:** `src/tui/views/chat.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - Mock `agent.chat()` with a delayed resolution (e.g., `setTimeout` promise).
  - Submit input to trigger `agent.chat()`.
  - Call `chatView.hide()` during the delay (simulating tab switch).
  - Verify the `agent.chat()` promise still resolves.
  - Verify the agent response is appended to the messages array and persisted to the store.
  - Verify `hide()` only sets `container.hidden = true` and does not call `agent.reset()` or clear messages.

---

## AC5: Zellij-safe keybindings

### tui-neo-blessed.AC5.1 — All navigation and interaction works using only arrows, Enter, Escape, Tab, Page Up/Down, F-keys, Space, and single letters

- **Verification:** Automated test (unit) + Human verification
- **Test files:** `src/tui/widgets/selectable-list.test.ts`, `src/tui/widgets/scrollable-viewer.test.ts`
- **Phase:** 2
- **Automated portion:** Widget tests verify that only blessed built-in key handling (arrow keys, Enter, mouse) is used -- no Ctrl/Alt bindings registered on widget elements.
- **Human verification:** Launch `bun start` inside a Zellij pane in default (non-locked) mode. Verify all navigation works: Tab/Shift+Tab cycles tabs, arrow keys navigate lists, Enter selects, Escape goes back, Page Up/Down scrolls, F5 opens search, Space toggles checkboxes, single-letter actions (n, d, a, e, s, g, r, v, q) work.

### tui-neo-blessed.AC5.2 — No keybinding uses Ctrl or Alt modifier (except Shift+Enter for multi-line in Zellij locked mode)

- **Verification:** Automated test (static analysis) + Human verification
- **Phase:** 8
- **Automated portion (Phase 8, Task 4, Step 5):** `grep -rn "'C-\|'M-" src/tui/ --include="*.ts"` returns only `'C-c'` in `index.ts`.
- **Justified deviation:** C-c is bound as unconditional quit. Universally expected as process termination; Zellij passes it through. Documented in phase_01.md Task 5.
- **Human verification:** Run the grep audit and confirm only C-c appears. Launch in Zellij and verify no other Ctrl/Alt binding is needed.

---

## AC6: Plain text input

### tui-neo-blessed.AC6.1 — Chat input box accepts and displays plain text without styling or ANSI codes

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/chat.test.ts`
- **Phase:** 4
- **What the test verifies:**
  - The `blessed.textarea` element is created without `tags: true` (preventing blessed tag interpretation in input).
  - Input text is retrieved via `textarea.getValue()` and passed to `agent.chat()` as-is, without ANSI processing.

---

## AC7: Catppuccin Macchiato theme

### tui-neo-blessed.AC7.1 — All UI elements use colours from the Catppuccin Macchiato palette

- **Verification:** Human verification
- **Phase:** 1
- **Justification:** Colour rendering is a visual property of the terminal. No automated test can confirm visual colour correctness.
- **Verification approach:** Launch `bun start` in a terminal with true-colour support. Visually confirm background is Catppuccin Macchiato base (#24273a), tab bar uses mantle/crust background, active tab uses mauve accent, text colours match the palette.

### tui-neo-blessed.AC7.2 — Semantic colour slots map to the same palette colours as the existing Ink TUI

- **Verification:** Automated test (unit) + Human verification
- **Test file:** `src/tui/views/format.test.ts`
- **Phase:** 1 (theme), 4 (format)
- **Automated portion:** `format.test.ts` verifies that `formatMessage()` output contains specific hex colour codes from `blessedStyles`.
- **Human verification:** Verify the `blessedStyles` mapping in `theme.ts` mirrors the existing `theme` object's colour assignments.

---

## AC8: Functional Core / Imperative Shell

### tui-neo-blessed.AC8.1 — Theme, types, syntax highlighting, and message formatting modules are pure functions with no side effects

- **Verification:** Automated test (unit) + Code review
- **Test files:** `src/tui/views/format.test.ts`, `src/tui/views/sessions.test.ts`, `src/tui/views/schedules.test.ts`, `src/tui/views/prune.test.ts`
- **Phase:** 3, 4, 5, 6
- **Automated portion:** Pure functions are tested as unit tests with deterministic inputs and outputs. No I/O, no side effects, no blessed dependencies in these functions.
- **Code review verification:** Confirm files annotated `// pattern: Functional Core` contain no `import blessed`, no `screen.render()`, no event subscriptions, no `process.*` calls.

### tui-neo-blessed.AC8.2 — View factories, index wiring, and widget constructors are annotated as Imperative Shell

- **Verification:** Code review (human)
- **Phase:** All phases
- **Justification:** File annotations are comments that cannot be tested for correctness.
- **Verification approach:** `grep -rn "// pattern:" src/tui/ --include="*.ts"` and confirm correct annotations on all files.

---

## AC9: New features

### tui-neo-blessed.AC9.1 — Chat input supports multi-line via Shift+Enter (in Zellij locked mode)

- **Verification:** Automated test (unit) + Human verification
- **Test file:** `src/tui/views/chat.test.ts`
- **Phase:** 4
- **Automated portion:** Test that Shift+Enter handling inserts a newline character into the textarea content rather than submitting.
- **Human verification:** Launch `bun start` inside Zellij. Enter locked mode (`Ctrl+G`). Type text, press Shift+Enter, type more text. Confirm multi-line content. Press Enter to submit.

### tui-neo-blessed.AC9.2 — F5 opens search overlay in chat that matches text and scrolls to first result

- **Verification:** Automated test (unit)
- **Test file:** `src/tui/views/chat.test.ts`
- **Phase:** 7
- **What the test verifies:**
  - `findMatches()` pure function: correct indices for case-insensitive matching, empty query returns empty, no matches returns empty.

### tui-neo-blessed.AC9.3 — F4 in SystemPrompt view opens editable textarea for prompt modification (nice-to-have)

- **Verification:** Deferred
- **Phase:** Not implemented
- **Justification:** Explicitly deferred as nice-to-have in the design document.

---

## AC10: Same external contract

### tui-neo-blessed.AC10.1 — `startTUI(deps: TuiDependencies)` remains the only export from `src/tui/`; `src/index.ts` requires no changes beyond the import

- **Verification:** Automated (static analysis) + operational
- **Phase:** 8
- **Automated portion:** grep confirms import unchanged, grep confirms exports, build succeeds, tests pass, no Ink/React imports remain.
- **Operational:** `bun start` launches the neo-blessed TUI successfully.

---

## Summary Table

| AC | Sub | Automated | Human | Test File(s) | Phase |
|----|-----|-----------|-------|-------------|-------|
| AC1 | 1.1 | Yes (unit) | - | `views/sessions.test.ts` | 3 |
| AC1 | 1.2 | Yes (unit+int) | - | `views/chat.test.ts` | 4 |
| AC1 | 1.3 | Yes (unit+int) | - | `views/tools.test.ts` | 5 |
| AC1 | 1.4 | Yes (unit+int) | - | `views/secrets.test.ts` | 5 |
| AC1 | 1.5 | Yes (unit) | - | `views/schedules.test.ts` | 5 |
| AC1 | 1.6 | Yes (unit) | - | `views/system-prompt.test.ts` | 6 |
| AC1 | 1.7 | Yes (unit+int) | - | `views/prune.test.ts` | 6 |
| AC2 | 2.1 | Yes (unit) | - | `widgets/scrollable-viewer.test.ts` | 2 |
| AC2 | 2.2 | Partial | Visual | `widgets/scrollable-viewer.test.ts` | 2 |
| AC2 | 2.3 | Yes (unit) | - | `widgets/selectable-list.test.ts` | 2 |
| AC2 | 2.4 | Yes (unit) | - | `widgets/scrollable-viewer.test.ts`, `views/chat.test.ts` | 2, 4 |
| AC3 | 3.1 | Yes (unit) | - | `views/format.test.ts` | 4 |
| AC3 | 3.2 | Yes (unit) | - | `views/format.test.ts` | 4 |
| AC3 | 3.3 | Yes (unit) | - | `views/format.test.ts` | 4 |
| AC4 | 4.1 | - | Visual | - | 1, 3 |
| AC4 | 4.2 | Yes (unit) | - | `tab-bar.test.ts` | 7 |
| AC4 | 4.3 | Yes (int) | - | `views/chat.test.ts` | 4 |
| AC5 | 5.1 | Partial | Zellij | `widgets/*.test.ts` | 2 |
| AC5 | 5.2 | Yes (grep) | Zellij | - | 8 |
| AC6 | 6.1 | Yes (unit) | - | `views/chat.test.ts` | 4 |
| AC7 | 7.1 | - | Visual | - | 1 |
| AC7 | 7.2 | Partial | Visual | `views/format.test.ts` | 1, 4 |
| AC8 | 8.1 | Yes (unit) | Review | `views/format.test.ts` + others | 3-6 |
| AC8 | 8.2 | - | Review | - | All |
| AC9 | 9.1 | Partial | Zellij | `views/chat.test.ts` | 4 |
| AC9 | 9.2 | Yes (unit) | - | `views/chat.test.ts` | 7 |
| AC9 | 9.3 | Deferred | Deferred | - | - |
| AC10 | 10.1 | Yes (static) | Operational | - | 8 |

## Deviation Log

| Deviation | AC Affected | Justification | Source |
|-----------|-------------|---------------|--------|
| C-c bound as unconditional quit | AC5.2 | Universally expected process termination; Zellij passes C-c through | phase_01.md Task 5 |
| AC9.3 deferred | AC9.3 | Marked as nice-to-have in design | Design doc, phase_06.md Task 1 |
| `archiveSession` without subAgent | AC1.7 | Intentional degradation matching current PruneScreen.tsx | phase_06.md Task 2 |

## Test File Inventory

All paths relative to project root:

| Test File | Phase | ACs Covered |
|-----------|-------|-------------|
| `src/tui/widgets/selectable-list.test.ts` | 2 | AC2.3, AC5.1 |
| `src/tui/widgets/scrollable-viewer.test.ts` | 2 | AC2.1, AC2.2, AC2.4, AC5.1 |
| `src/tui/widgets/status-bar.test.ts` | 2 | (infrastructure) |
| `src/tui/views/sessions.test.ts` | 3 | AC1.1, AC8.1 |
| `src/tui/views/format.test.ts` | 4 | AC3.1, AC3.2, AC3.3, AC7.2 |
| `src/tui/views/chat.test.ts` | 4, 7 | AC1.2, AC2.4, AC4.3, AC6.1, AC9.1, AC9.2 |
| `src/tui/views/tools.test.ts` | 5 | AC1.3 |
| `src/tui/views/secrets.test.ts` | 5 | AC1.4 |
| `src/tui/views/schedules.test.ts` | 5 | AC1.5 |
| `src/tui/views/system-prompt.test.ts` | 6 | AC1.6 |
| `src/tui/views/prune.test.ts` | 6 | AC1.7 |
| `src/tui/tab-bar.test.ts` | 7 | AC4.2 |

## Human Verification Checklist

Items requiring manual testing due to terminal rendering, Zellij key passthrough, or visual properties:

- [ ] **AC4.1** — Tab bar visible at top of all 7 screens with correct labels and active highlighting
- [ ] **AC5.1** — All navigation works in Zellij default mode without Ctrl/Alt
- [ ] **AC5.2** — Grep audit confirms only C-c uses Ctrl modifier; Zellij operational confirm
- [ ] **AC7.1** — All UI elements visually use Catppuccin Macchiato palette colours
- [ ] **AC7.2** — Semantic colour slots visually match existing Ink TUI mappings
- [ ] **AC8.2** — `grep "// pattern:" src/tui/` confirms correct annotations on all files
- [ ] **AC9.1** — Shift+Enter inserts newline in Zellij locked mode
- [ ] **AC2.2** — Mouse wheel actually scrolls chat history
- [ ] **AC10.1** — `bun start` launches successfully; `src/index.ts` call site unchanged
