# Test Requirements: TUI UX Fix

## Overview

This document maps every acceptance criterion from the TUI UX Fix design plan to either an automated test or a documented manual verification procedure. All automated tests use the standard Go `testing` package with table-driven `t.Run()` subtests, direct Bubble Tea `Update()` calls, and `t.Errorf` assertions. Test files are colocated with source in `tui/internal/app/`.

---

## AC1: TUI launches directly into a new chat session

### tui-ux-fix.AC1.1 — On launch, user sees chat screen with empty conversation and input focused

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestNewAppModel_WithInitialSession`
**Verifies:**
- `NewAppModel(client, backend, "test-session-id")` sets `activeScreen` to `ScreenChat`
- `screenStack` is `[ScreenChat]`
- `chat` is non-nil with `sessionID` matching the provided ID
- `sessions` is nil (not initialized when starting directly into chat)

### tui-ux-fix.AC1.2 — New session appears in session list when navigating to `/sessions`

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_SlashSessionsFromInitialChat`
**Verifies:**
- Start with initial session ID, send `SlashCommandMsg{Command: "sessions"}`
- `activeScreen` becomes `ScreenSessions`
- `screenStack` is `[ScreenChat, ScreenSessions]`
- `sessions` model is initialized (non-nil)

> Note: Verifying that the specific session actually appears in the list requires a live RPC call (the sessions model fetches via `session/list`). The unit test confirms the navigation path is correct. Full verification that the session is persisted and returned by the backend is an integration concern covered by the existing `bun test` suite on the TS side.

### tui-ux-fix.AC1.3 — If `session/create` RPC fails, TUI falls back to session list with error

**Type:** Unit (automated) + Manual verification
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestNewAppModel_FallbackWithoutSession`
**Verifies:**
- `NewAppModel(client, backend, "")` (empty session ID, simulating RPC failure) sets `activeScreen` to `ScreenSessions`
- `screenStack` is `[ScreenSessions]`
- `sessions` is non-nil
- `chat` is nil

**Manual verification (error banner):**
The error message is written to stderr in `main.go` before `NewAppModel` is called. The actual stderr output and any error banner rendering require a running process.
1. Stop the TS backend (or make it unreachable)
2. Run `just dev`
3. Confirm the TUI opens on the session list, not a blank chat
4. Check stderr output for "warning: failed to create initial session"

**Why partial manual:** The `main.go` startup sequence is imperative shell code that orchestrates process spawning, RPC calls, and Bubble Tea program creation. Mocking the full startup pipeline adds significant test infrastructure for a single error path that is trivially verifiable by hand.

### tui-ux-fix.AC1.4 — Multiple rapid launches each create independent sessions

**Type:** Manual verification
**Procedure:**
1. Open three terminal tabs
2. Run `just dev` in each tab within 2-3 seconds
3. In each tab, type `/sessions` and press Enter
4. Confirm each tab shows a different session at the top of the list (different session IDs or auto-generated titles)

**Why manual:** This tests process-level isolation and RPC timing. Each launch is a separate OS process with its own backend instance. Unit tests operate on a single in-process model and cannot verify cross-process session independence.

---

## AC2: Slash commands route to correct screens

### tui-ux-fix.AC2.1 — Each slash command navigates to its respective screen

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_SlashCommandRouting`
**Verifies (table-driven, one subtest per command):**

| Subtest | Input | Expected `activeScreen` | Stack top |
|---|---|---|---|
| `sessions` | `SlashCommandMsg{Command: "sessions"}` | `ScreenSessions` | `ScreenSessions` |
| `tools` | `SlashCommandMsg{Command: "tools"}` | `ScreenTools` | `ScreenTools` |
| `secrets` | `SlashCommandMsg{Command: "secrets"}` | `ScreenSecrets` | `ScreenSecrets` |
| `schedules` | `SlashCommandMsg{Command: "schedules"}` | `ScreenSchedules` | `ScreenSchedules` |
| `prompt` | `SlashCommandMsg{Command: "prompt"}` | `ScreenPrompt` | `ScreenPrompt` |

Each subtest starts from `NewAppModel(client, backend, "session-id")` (chat screen), sends the slash command, and asserts the resulting screen and stack state.

### tui-ux-fix.AC2.2 — `/back` pops the stack, `/quit` exits

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test names:** `TestAppModel_SlashBack`, `TestAppModel_SlashQuit`

`TestAppModel_SlashBack`:
- Start with initial session, push tools screen (stack `[Chat, Tools]`)
- Send `SlashCommandMsg{Command: "back"}`
- Assert `activeScreen == ScreenChat`, stack is `[ScreenChat]`

`TestAppModel_SlashQuit`:
- Send `SlashCommandMsg{Command: "quit"}`
- Assert the returned `tea.Cmd` produces a `tea.QuitMsg` (invoke the cmd and type-assert the result)

### tui-ux-fix.AC2.3 — `/new` creates a fresh session and replaces chat without pushing

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_NewSessionReplacesChat`
**Verifies:**
- Start with initial session "old-session" (stack `[Chat]`)
- Send `newSessionCreatedMsg{sessionID: "new-session"}` (simulating the async RPC result)
- Assert `chat.sessionID == "new-session"`
- Assert stack length is still 1 (`[ScreenChat]`)
- Assert `activeScreen == ScreenChat`

Additionally, `TestAppModel_SlashNewReturnsCmd`:
- Send `SlashCommandMsg{Command: "new"}`
- Assert the returned `tea.Cmd` is non-nil (it triggers the async `session/create` RPC)

### tui-ux-fix.AC2.4 — Unknown slash commands are silently ignored

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_UnknownSlashCommandIgnored`
**Verifies:**
- Start with initial session on chat screen
- Send `SlashCommandMsg{Command: "foo"}`
- Assert `activeScreen` unchanged (`ScreenChat`)
- Assert returned `tea.Cmd` is nil
- Assert no panic (test completing without panic is sufficient)

### tui-ux-fix.AC2.5 — Slash commands only trigger on Enter, not while typing

**Type:** Manual verification
**Procedure:**
1. Launch the TUI with `just dev`
2. Type `/to` in the chat input (do not press Enter)
3. Confirm the screen remains on Chat (no navigation)
4. Type `ols` to complete `/tools` (still do not press Enter)
5. Confirm the screen still remains on Chat
6. Press Enter
7. Confirm the screen navigates to Tools

**Why manual:** Slash command interception happens in `chat.go`'s `Update()` on `tea.KeyPressMsg` for the Enter key, which checks the textarea value. Testing the "no navigation while typing" invariant requires simulating incremental keystrokes and verifying no `SlashCommandMsg` is emitted until Enter. The existing test pattern (direct `Update()` calls with message types) skips the textarea layer.

---

## AC3: Stack-based back-navigation works correctly

### tui-ux-fix.AC3.1 — Escape from any non-chat screen returns to previous screen

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_EscapePopScreen` (existing test, updated)
**Verifies:**
- Start with initial session (stack `[Chat]`), push tools (stack `[Chat, Tools]`)
- Send `popScreenMsg{}`
- Assert `activeScreen == ScreenChat`, stack is `[ScreenChat]`

Additional subtests for each screen type:
- Push secrets, pop, verify return to chat
- Push schedules, pop, verify return to chat
- Push prompt, pop, verify return to chat
- Push sessions, pop, verify return to chat

### tui-ux-fix.AC3.2 — Selecting a session replaces chat and pops sessions screen

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_SessionSelectionPopsSessionsScreen`
**Verifies:**
- Start with initial session "original" (stack `[Chat]`)
- Push sessions (stack `[Chat, Sessions]`)
- Send `NavigateToChatMsg{SessionID: "selected-session"}`
- Assert `chat.sessionID == "selected-session"`
- Assert stack is `[ScreenChat]` (sessions screen popped, chat replaced)
- Assert `activeScreen == ScreenChat`

### tui-ux-fix.AC3.3 — After `/new`, escape from chat is a no-op

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_EscapeOnRootChatDoesNothing`
**Verifies:**
- Start with initial session (stack `[Chat]`)
- Send `newSessionCreatedMsg{sessionID: "new-session"}` (simulating `/new`)
- Send `popScreenMsg{}`
- Assert stack is still `[ScreenChat]` (unchanged)
- Assert `activeScreen == ScreenChat`
- Assert `chat.sessionID == "new-session"` (still the new session)

### tui-ux-fix.AC3.4 — Deep stack unwinds correctly

**Type:** Unit (automated)
**Test file:** `tui/internal/app/app_test.go`
**Test name:** `TestAppModel_DeepStackUnwind`
**Verifies:**
- Start with initial session (stack `[Chat]`)
- Push sessions (stack `[Chat, Sessions]`)
- Push tools (stack `[Chat, Sessions, Tools]`)
- Send `popScreenMsg{}` -- assert `activeScreen == ScreenSessions`, stack `[Chat, Sessions]`
- Send `popScreenMsg{}` -- assert `activeScreen == ScreenChat`, stack `[Chat]`

---

## AC4: Session list renders with compact item density

### tui-ux-fix.AC4.1 — Each session occupies exactly one line

**Type:** Unit (automated)
**Test file:** `tui/internal/app/sessions_test.go`
**Test name:** `TestSessionDelegate_HeightAndSpacing`
**Verifies:**
- `sessionDelegate.Height()` returns `1`
- `sessionDelegate.Spacing()` returns `0`

### tui-ux-fix.AC4.2 — Selected session has visual highlight and prefix

**Type:** Unit (automated) + Manual verification
**Test file:** `tui/internal/app/sessions_test.go`
**Test name:** `TestSessionDelegate_RenderSelected`
**Verifies:**
- Create a `sessionDelegate`, render a selected item (index matches list index) to a `bytes.Buffer`
- Assert output string contains `▸` prefix

**Manual verification (colour/background):**
1. Launch TUI, type `/sessions`
2. Confirm the selected session row has a visually distinct background colour
3. Confirm the `▸` prefix appears on the selected row only
4. Arrow down/up and confirm the highlight follows

**Why partial manual:** ANSI escape sequences for background colours are present in the rendered output but asserting exact escape codes is brittle (varies by terminal capabilities and lipgloss version). The unit test confirms the structural prefix; visual styling is confirmed by eye.

### tui-ux-fix.AC4.3 — Untitled sessions display truncated session ID

**Type:** Unit (automated)
**Test file:** `tui/internal/app/sessions_test.go`
**Test name:** `TestSessionItem_TitleUntitled`
**Verifies (table-driven):**
- `sessionItem{id: "2af671abcdef", title: nil}` -- `Title()` returns `"session 2af671..."`
- `sessionItem{id: "abc", title: nil}` -- `Title()` returns `"session abc"` (short ID, no truncation)
- `sessionItem{id: "2af671abcdef", title: ptr("email-digest")}` -- `Title()` returns `"email-digest"`

### tui-ux-fix.AC4.4 — List filtering works on session titles

**Type:** Unit (automated)
**Test file:** `tui/internal/app/sessions_test.go`
**Test name:** `TestSessionItem_FilterValue`
**Verifies:**
- `sessionItem{id: "abc123", title: ptr("email-digest")}` -- `FilterValue()` returns `"email-digest"`
- `sessionItem{id: "abc123", title: nil}` -- `FilterValue()` returns `"session abc123"`

### tui-ux-fix.AC4.5 — Session list with 0 items shows empty state message

**Type:** Manual verification
**Procedure:**
1. Clear all sessions from the database (or use a fresh data directory)
2. Launch TUI, type `/sessions`
3. Confirm an empty state message is displayed (Bubble Tea's default list empty state)

**Why manual:** The empty state is rendered by Bubble Tea's built-in `list.Model` when no items match. No custom code is involved -- this is default framework behaviour.

---

## AC5: RPC errors are visible

### tui-ux-fix.AC5.1 — Failed message load shows error in status pane

**Type:** Unit (automated)
**Test file:** `tui/internal/app/chat_test.go`
**Test name:** `TestChatModel_MessagesErrorSetsStatus`
**Verifies:**
- Create `ChatModel`, send `messagesErrorMsg{err: fmt.Errorf("connection refused")}`
- Assert `model.status` contains `"connection refused"`
- Assert `model.status` starts with `"Error:"`
- Assert `model.statusError == true`
- Assert `model.spinning == false`

### tui-ux-fix.AC5.2 — User can still type and send messages after a load error

**Type:** Unit (automated)
**Test file:** `tui/internal/app/chat_test.go`
**Test name:** `TestChatModel_CanStillTypeAfterError`
**Verifies:**
- Create `ChatModel`, send `messagesErrorMsg` to put it in error state
- Assert `statusError == true`
- Set textarea value to `"hello"`, send Enter key via `tea.KeyPressMsg`
- Assert returned `tea.Cmd` is non-nil (chat request initiated despite error state)
- Assert the textarea is cleared (message was consumed, not rejected)

### tui-ux-fix.AC5.3 — Failed pagination preserves existing messages

**Type:** Unit (automated)
**Test file:** `tui/internal/app/chat_test.go`
**Test name:** `TestChatModel_LoadOlderErrorPreservesMessages`
**Verifies:**
- Create `ChatModel`, send `messagesLoadedMsg` with 3 messages to populate initial state
- Assert `len(model.messages) == 3`
- Send `loadOlderErrorMsg{err: fmt.Errorf("timeout")}`
- Assert `len(model.messages) == 3` (unchanged)
- Assert `model.status` contains `"timeout"`
- Assert `model.statusError == true`

---

## AC6: Existing behaviour preserved

### tui-ux-fix.AC6.1 — Chat hybrid layout renders correctly

**Type:** Manual verification
**Procedure:**
1. Launch TUI with `just dev`
2. Confirm three distinct zones are visible: message viewport (top), status pane (middle), input textarea (bottom)
3. Send a message and confirm it appears in the viewport
4. Confirm the status pane shows "Ready" when idle and "Thinking..." during processing

**Why manual:** Layout rendering depends on terminal dimensions, lipgloss styling, and viewport calculations. No screenshot-comparison or golden-file test infrastructure exists.

### tui-ux-fix.AC6.2 — Agent responses render as formatted markdown

**Type:** Manual verification
**Procedure:**
1. Send a message that elicits a markdown response (e.g., "list three items with bullet points")
2. Confirm the response renders with formatted markdown (bullets, bold, code blocks) via glamour styling, not raw markdown syntax

**Why manual:** Markdown rendering is handled by the `render/` package via glamour. No changes are made to this package in any phase.

### tui-ux-fix.AC6.3 — Streaming events update status pane in real-time

**Type:** Unit (automated, existing) + Manual verification
**Test file:** `tui/internal/app/chat_test.go`
**Existing test:** Tests verifying `agentEventMsg` handling (already exist)

**Manual verification:**
1. Send a message that triggers tool use
2. Watch the status pane during processing
3. Confirm status updates appear in real-time (e.g., "Thinking...", "Running code...", stats on completion)

**Why partial manual:** Existing unit tests confirm event handling works at the model level. Real-time visual updates depend on Bubble Tea's event loop and terminal refresh.

### tui-ux-fix.AC6.4 — Cursor-based pagination loads older messages on scroll-up

**Type:** Manual verification
**Procedure:**
1. Open a session with more than 50 messages (or send enough messages to exceed one page)
2. Scroll up to the top of the viewport
3. Confirm older messages load automatically (new content appears above)
4. Confirm no messages are duplicated or lost during pagination

**Why manual:** Pagination triggering depends on viewport scroll position detection and the async `loadOlderMessages()` command. The trigger mechanism is tied to viewport state which is difficult to simulate without a running terminal.

---

## Summary Matrix

| AC | ID | Automated | Manual | Test File | Test Name |
|---|---|---|---|---|---|
| AC1 | 1.1 | Yes | - | `app_test.go` | `TestNewAppModel_WithInitialSession` |
| AC1 | 1.2 | Yes | - | `app_test.go` | `TestAppModel_SlashSessionsFromInitialChat` |
| AC1 | 1.3 | Partial | Yes | `app_test.go` | `TestNewAppModel_FallbackWithoutSession` |
| AC1 | 1.4 | No | Yes | - | Process-level multi-launch check |
| AC2 | 2.1 | Yes | - | `app_test.go` | `TestAppModel_SlashCommandRouting` |
| AC2 | 2.2 | Yes | - | `app_test.go` | `TestAppModel_SlashBack`, `TestAppModel_SlashQuit` |
| AC2 | 2.3 | Yes | - | `app_test.go` | `TestAppModel_NewSessionReplacesChat` |
| AC2 | 2.4 | Yes | - | `app_test.go` | `TestAppModel_UnknownSlashCommandIgnored` |
| AC2 | 2.5 | No | Yes | - | Incremental typing check |
| AC3 | 3.1 | Yes | - | `app_test.go` | `TestAppModel_EscapePopScreen` |
| AC3 | 3.2 | Yes | - | `app_test.go` | `TestAppModel_SessionSelectionPopsSessionsScreen` |
| AC3 | 3.3 | Yes | - | `app_test.go` | `TestAppModel_EscapeOnRootChatDoesNothing` |
| AC3 | 3.4 | Yes | - | `app_test.go` | `TestAppModel_DeepStackUnwind` |
| AC4 | 4.1 | Yes | - | `sessions_test.go` | `TestSessionDelegate_HeightAndSpacing` |
| AC4 | 4.2 | Partial | Yes | `sessions_test.go` | `TestSessionDelegate_RenderSelected` |
| AC4 | 4.3 | Yes | - | `sessions_test.go` | `TestSessionItem_TitleUntitled` |
| AC4 | 4.4 | Yes | - | `sessions_test.go` | `TestSessionItem_FilterValue` |
| AC4 | 4.5 | No | Yes | - | Empty list visual check |
| AC5 | 5.1 | Yes | - | `chat_test.go` | `TestChatModel_MessagesErrorSetsStatus` |
| AC5 | 5.2 | Yes | - | `chat_test.go` | `TestChatModel_CanStillTypeAfterError` |
| AC5 | 5.3 | Yes | - | `chat_test.go` | `TestChatModel_LoadOlderErrorPreservesMessages` |
| AC6 | 6.1 | No | Yes | - | Layout visual check |
| AC6 | 6.2 | No | Yes | - | Markdown rendering visual check |
| AC6 | 6.3 | Partial | Yes | `chat_test.go` | Existing event handling tests |
| AC6 | 6.4 | No | Yes | - | Scroll-up pagination check |

**Totals:** 17 automated, 4 partially automated (unit + manual), 5 manual-only
