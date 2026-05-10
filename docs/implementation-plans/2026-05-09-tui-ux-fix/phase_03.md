# TUI UX Fix Implementation Plan — Phase 3: Error Visibility & Polish

**Goal:** Surface all RPC errors visibly in the status pane instead of silently swallowing them.

**Architecture:** Add a `messagesErrorMsg` type to chat. When `Init()` or `loadOlderMessages()` encounters an RPC error, return `messagesErrorMsg` instead of an empty success message. The `Update()` handler sets the status pane to the error text with red styling. The user can still type and send messages after errors — errors are informational, not blocking. Startup fallback error banner is already handled by Phase 1 (empty `initialSessionID` falls back to sessions screen).

**Tech Stack:** Go, Bubble Tea v2, lipgloss v2

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-ux-fix.AC5: RPC errors are visible
- **tui-ux-fix.AC5.1 Success:** Failed message load on chat entry shows error in status pane with red styling
- **tui-ux-fix.AC5.2 Success:** User can still type and send messages after a load error
- **tui-ux-fix.AC5.3 Failure:** Failed older-message pagination shows error without losing already-loaded messages

### tui-ux-fix.AC6: Existing behaviour preserved
- **tui-ux-fix.AC6.1 Success:** Chat hybrid layout (viewport + status + input) renders correctly
- **tui-ux-fix.AC6.2 Success:** Agent responses render as formatted markdown via glamour
- **tui-ux-fix.AC6.3 Success:** Streaming events update status pane in real-time during agent processing
- **tui-ux-fix.AC6.4 Success:** Cursor-based pagination loads older messages on scroll-up

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add `messagesErrorMsg` type and update `Init()` to surface RPC errors

**Verifies:** tui-ux-fix.AC5.1

**Files:**
- Modify: `tui/internal/app/chat.go:46-49` (add new message type after `messagesLoadedMsg`)
- Modify: `tui/internal/app/chat.go:115-127` (update `Init()` to return error msg on failure)

**Implementation:**

Add a new message type after `messagesLoadedMsg` (around line 49):

```go
type messagesErrorMsg struct {
	err error
}
```

Update `Init()` to return `messagesErrorMsg` on RPC failure instead of empty `messagesLoadedMsg`:

```go
func (m *ChatModel) Init() tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionMessagesResult
		err := m.client.Call(context.Background(), "session/messages", protocol.SessionMessagesParams{
			SessionID: m.sessionID,
			Limit:     50,
		}, &result)
		if err != nil {
			return messagesErrorMsg{err: err}
		}
		return messagesLoadedMsg{messages: result.Messages, cursor: result.Cursor}
	}
}
```

**Testing:**

Tests must verify:
- tui-ux-fix.AC5.1: When `messagesErrorMsg` is received, status shows error text

Add test `TestChatModel_MessagesErrorSetsStatus`:
- Create a `ChatModel` with `NewChatModel(client, "session-id")`
- Send `messagesErrorMsg{err: fmt.Errorf("connection refused")}` to `Update()`
- Assert `model.status` contains "connection refused"
- Assert `model.status` contains "Error" prefix or similar indicator

Follow project testing pattern from `chat_test.go`: `newChatClient()` helper, direct `Update()` calls, `t.Errorf` assertions.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestChatModel_MessagesError"
```

Expected: Test passes.

**Commit:** `feat(tui): add messagesErrorMsg type and surface Init errors`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Handle `messagesErrorMsg` in `Update()` with red status styling

**Verifies:** tui-ux-fix.AC5.1, tui-ux-fix.AC5.2

**Files:**
- Modify: `tui/internal/app/chat.go:129-209` (add `messagesErrorMsg` case to `Update()`)
- Modify: `tui/internal/app/chat.go:354-382` (add red styling for error status in `View()`)

**Implementation:**

Add a `messagesErrorMsg` case in the `Update()` switch, after the `messagesLoadedMsg` case (around line 159):

```go
case messagesErrorMsg:
	m.status = fmt.Sprintf("Error: %v", msg.err)
	m.spinning = false
```

Add an `statusError` field to `ChatModel` to track error state for styling:

```go
type ChatModel struct {
	// ... existing fields ...
	statusError bool
}
```

Update the `messagesErrorMsg` handler to set the error flag:

```go
case messagesErrorMsg:
	m.status = fmt.Sprintf("Error: %v", msg.err)
	m.statusError = true
	m.spinning = false
```

Clear the error flag in all handlers that set normal status. Add `m.statusError = false` to each of these existing handlers in `Update()`:

1. `messagesLoadedMsg` case (line ~147) — after setting messages, add `m.statusError = false`
2. `loadOlderMsg` case (line ~161) — after prepending older messages, add `m.statusError = false`
3. `chatStartedMsg` case (line ~185) — already sets `m.status = "Thinking..."`, add `m.statusError = false`
4. `agentEventMsg` case (line ~191) — delegates to `handleAgentEvent`, add `m.statusError = false` before the call
5. `agentResponseMsg` case (line ~196) — delegates to `handleAgentResponse`, add `m.statusError = false` before the call

This ensures that any successful operation clears a prior error state.

In `View()`, apply red styling when `statusError` is true:

```go
statusText := m.status
if statusText == "" {
	statusText = "Ready"
}
statusStyle := lipgloss.NewStyle().
	Border(lipgloss.NormalBorder(), true, false, false, false).
	Padding(0, 1).
	Height(chatLayout.StatusHeight)
if m.statusError {
	statusStyle = statusStyle.Foreground(lipgloss.Color("1"))
}
statusPane := statusStyle.Render(statusText)
```

The user can still type and send messages — the textarea remains functional regardless of status error state. Nothing blocks input on error.

**Testing:**

Tests must verify:
- tui-ux-fix.AC5.1: `statusError` is `true` after receiving `messagesErrorMsg`
- tui-ux-fix.AC5.2: After a load error, sending a chat message still works (textarea accepts input, enter triggers chat)

Add test `TestChatModel_CanStillTypeAfterError`:
- Create chat model, send `messagesErrorMsg`
- Verify `statusError == true`
- Set textarea value to "hello", send enter key
- Verify a command is returned (chat initiated despite error state)

Follow project testing patterns.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestChatModel_CanStillType|TestChatModel_MessagesError"
```

Expected: All tests pass.

**Commit:** `feat(tui): render error status with red styling`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Surface errors in `loadOlderMessages()` without losing existing messages

**Verifies:** tui-ux-fix.AC5.3

**Files:**
- Modify: `tui/internal/app/chat.go:46-49` (add `loadOlderErrorMsg` type)
- Modify: `tui/internal/app/chat.go:330-343` (update `loadOlderMessages()` to return error msg)
- Modify: `tui/internal/app/chat.go:129-209` (add handler for `loadOlderErrorMsg`)

**Implementation:**

Add a new message type for pagination errors:

```go
type loadOlderErrorMsg struct {
	err error
}
```

Update `loadOlderMessages()` to return error msg on failure:

```go
func (m *ChatModel) loadOlderMessages() tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionMessagesResult
		err := m.client.Call(context.Background(), "session/messages", protocol.SessionMessagesParams{
			SessionID: m.sessionID,
			Limit:     50,
			Cursor:    m.messageCursor,
		}, &result)
		if err != nil {
			return loadOlderErrorMsg{err: err}
		}
		return loadOlderMsg{messages: result.Messages, cursor: result.Cursor}
	}
}
```

Add handler in `Update()`:

```go
case loadOlderErrorMsg:
	m.status = fmt.Sprintf("Error loading older messages: %v", msg.err)
	m.statusError = true
```

This preserves already-loaded messages — only the status changes. The `m.messages` slice is untouched.

**Testing:**

Tests must verify:
- tui-ux-fix.AC5.3: After receiving `loadOlderErrorMsg`, existing messages are preserved and status shows error

Add test `TestChatModel_LoadOlderErrorPreservesMessages`:
- Create chat model, send `messagesLoadedMsg` with 3 messages
- Verify `len(model.messages) == 3`
- Send `loadOlderErrorMsg{err: fmt.Errorf("timeout")}`
- Verify `len(model.messages) == 3` (unchanged)
- Verify `model.status` contains "timeout"
- Verify `model.statusError == true`

Follow project testing patterns.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestChatModel_LoadOlderError"
```

Expected: Test passes.

**Commit:** `feat(tui): surface pagination errors without losing messages`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Run full test suite and verify all changes across all phases

**Verifies:** tui-ux-fix.AC5.1, tui-ux-fix.AC5.2, tui-ux-fix.AC5.3, tui-ux-fix.AC6.1, tui-ux-fix.AC6.2, tui-ux-fix.AC6.3, tui-ux-fix.AC6.4

**Files:**
- No modifications — verification only

**Verification:**

```bash
cd tui && go test ./...
```

Expected: All tests pass across all packages.

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

AC6 (existing behaviour preserved) is verified by:
- tui-ux-fix.AC6.1: Existing `View()` tests and build success confirm layout renders
- tui-ux-fix.AC6.2: No changes to `render/` package — glamour rendering untouched
- tui-ux-fix.AC6.3: No changes to `agentEventMsg` handler — streaming events still update status
- tui-ux-fix.AC6.4: `loadOlderMessages()` still triggers on scroll-up when cursor exists — only error path changed

**Commit:** No commit — verification step only.
<!-- END_TASK_4 -->
