# TUI UX Fix Implementation Plan — Phase 1: Startup Flow & Navigation Fix

**Goal:** Launch directly into a new chat session and fix stack-based navigation so escape always returns to the previous screen.

**Architecture:** Modify `main.go` to create a session via RPC before app init. Replace `backToSessionsMsg` with `popScreenMsg` across all screens. Add `/new` and `/sessions` slash commands. The screen stack starts as `[ScreenChat]` instead of `[ScreenSessions]`.

**Tech Stack:** Go, Bubble Tea v2, JSON-RPC 2.0

**Scope:** 3 phases from original design (phase 1 of 3)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-ux-fix.AC1: TUI launches directly into a new chat session
- **tui-ux-fix.AC1.1 Success:** On launch, user sees the chat screen with an empty conversation and the input area focused — no session list shown
- **tui-ux-fix.AC1.2 Success:** The new session appears in the session list when navigating to `/sessions` after launch
- **tui-ux-fix.AC1.3 Failure:** If `session/create` RPC fails on startup, TUI falls back to session list with visible error message

### tui-ux-fix.AC2: Slash commands route to correct screens
- **tui-ux-fix.AC2.1 Success:** `/sessions`, `/tools`, `/secrets`, `/schedules`, `/prompt` each navigate to their respective full-screen views
- **tui-ux-fix.AC2.2 Success:** `/back` and `/quit` pop the screen stack and exit the TUI respectively
- **tui-ux-fix.AC2.3 Success:** `/new` creates a fresh session and replaces the current chat without pushing onto the stack
- **tui-ux-fix.AC2.4 Failure:** Unknown slash commands (e.g., `/foo`) are silently ignored — no crash or error

### tui-ux-fix.AC3: Stack-based back-navigation works correctly
- **tui-ux-fix.AC3.1 Success:** Escape from any non-chat screen returns to the previous screen in the stack (not always sessions)
- **tui-ux-fix.AC3.2 Success:** Selecting a session from `/sessions` replaces the current chat and pops the sessions screen
- **tui-ux-fix.AC3.3 Success:** After `/new`, escape from chat behaves the same as the original chat (no orphaned stack entries)
- **tui-ux-fix.AC3.4 Edge:** Deep stack (`Chat → Sessions → Tools`) unwinds correctly: escape from Tools → Sessions, escape from Sessions → Chat

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Replace `backToSessionsMsg` with `popScreenMsg` across all screens

**Verifies:** tui-ux-fix.AC3.1

**Files:**
- Modify: `tui/internal/app/chat.go:68` (rename type)
- Modify: `tui/internal/app/app.go:174` (rename handler)
- Modify: `tui/internal/app/tools.go:117` (rename usage)
- Modify: `tui/internal/app/secrets.go:83` (rename usage)
- Modify: `tui/internal/app/schedules.go:57` (rename usage)
- Modify: `tui/internal/app/prompt.go:56` (rename usage)
- Modify: `tui/internal/app/sessions.go:60-74` (add escape handler for when sessions is a pushed screen)
- Modify: `tui/internal/app/app_test.go` (rename in tests)

**Note:** The `ctrl+` keybindings (ctrl+t, ctrl+s, etc.) were already removed in commit `2612e3c`. No action needed for those.

**Implementation:**

In `tui/internal/app/chat.go`, rename the type at line 68:

```go
// Before:
type backToSessionsMsg struct {}

// After:
type popScreenMsg struct{}
```

In `tui/internal/app/chat.go`, update the escape handler at lines 248-251:

```go
// Before:
case "escape":
    return m, func() tea.Msg {
        return backToSessionsMsg{}
    }

// After:
case "escape":
    return m, func() tea.Msg {
        return popScreenMsg{}
    }
```

In `tui/internal/app/app.go`, update the handler at lines 174-177:

```go
// Before:
case backToSessionsMsg:
    // Return to sessions screen
    m.popScreen()
    return m, nil

// After:
case popScreenMsg:
    m.popScreen()
    return m, nil
```

In `tui/internal/app/tools.go` line 117, `tui/internal/app/secrets.go` line 83, `tui/internal/app/schedules.go` line 57, `tui/internal/app/prompt.go` line 56 — each has the same pattern:

```go
// Before:
case "escape":
    return m, func() tea.Msg { return backToSessionsMsg{} }

// After:
case "escape":
    return m, func() tea.Msg { return popScreenMsg{} }
```

In `tui/internal/app/sessions.go`, add an escape handler inside the `tea.KeyPressMsg` switch (before the `"enter"` case). The sessions screen now needs escape navigation because it can be a pushed screen (stack `[Chat, Sessions]`). Only emit `popScreenMsg` when the list is not in filter mode — during filtering, let the list handle escape internally:

```go
case "escape":
    if m.list.FilterState() == list.Filtering || m.list.FilterState() == list.FilterApplied {
        break // let list handle escape during filtering
    }
    return m, func() tea.Msg { return popScreenMsg{} }
```

In `tui/internal/app/app_test.go`, update all references to `backToSessionsMsg` to `popScreenMsg`. Affected tests:
- `TestAppModel_EscapePopScreen` (line 167)
- `TestAppModel_ScreenStackMaintainsHistory` (lines 201, 212)
- `TestAppModel_EscapeAtRootDoesNothing` (line 298)

**Testing:**

Tests must verify:
- tui-ux-fix.AC3.1: Escape from a pushed screen returns to the previous screen, not always sessions

The existing tests (`TestAppModel_EscapePopScreen`, `TestAppModel_ScreenStackMaintainsHistory`, `TestAppModel_EscapeAtRootDoesNothing`) already verify stack-based navigation. Updating them to use `popScreenMsg` confirms the rename works correctly.

Follow the project testing pattern: standard `testing` package, direct `Update()` calls, manual assertions with `t.Errorf`.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestAppModel_Escape|TestAppModel_ScreenStack"
```

Expected: All tests pass.

**Commit:** `refactor(tui): rename backToSessionsMsg to popScreenMsg`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update `NewAppModel` to accept an initial session ID and start on chat screen

**Verifies:** tui-ux-fix.AC1.1

**Files:**
- Modify: `tui/internal/app/app.go:52-60` (change `NewAppModel` signature and init logic)
- Modify: `tui/internal/app/app_test.go` (update all `NewAppModel` calls, add new test)

**Implementation:**

Change `NewAppModel` signature to accept an optional initial session ID. When provided, start on `ScreenChat` with a `ChatModel` for that session instead of `ScreenSessions`:

```go
func NewAppModel(client *protocol.Client, backend *backend.BackendProcess, initialSessionID string) *AppModel {
	m := &AppModel{
		client:  client,
		backend: backend,
	}

	if initialSessionID != "" {
		m.activeScreen = ScreenChat
		m.screenStack = []ScreenType{ScreenChat}
		m.chat = NewChatModel(client, initialSessionID)
	} else {
		m.activeScreen = ScreenSessions
		m.screenStack = []ScreenType{ScreenSessions}
		m.sessions = NewSessionsModel(client)
	}

	return m
}
```

Update `Init()` to handle both startup paths:

```go
func (m *AppModel) Init() tea.Cmd {
	cmds := []tea.Cmd{watchBackend(m.backend)}
	if m.chat != nil {
		cmds = append(cmds, m.chat.Init())
	}
	if m.sessions != nil {
		cmds = append(cmds, m.sessions.Init())
	}
	return tea.Batch(cmds...)
}
```

Update all existing `NewAppModel` calls in test files to pass empty string `""` as the third argument.

**Testing:**

Tests must verify:
- tui-ux-fix.AC1.1: When `initialSessionID` is non-empty, app starts on `ScreenChat` with chat model initialized

Add test `TestNewAppModel_WithInitialSession`:
- Create app with `NewAppModel(client, backend, "test-session-123")`
- Assert `activeScreen == ScreenChat`
- Assert `screenStack == [ScreenChat]`
- Assert `chat != nil` and `chat.sessionID == "test-session-123"`
- Assert `sessions == nil` (not initialized when starting with session)

Follow project testing pattern from `app_test.go`: `newMockClient()`, `newMockBackendProcess()`, direct field assertions with `t.Errorf`.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestNewAppModel"
```

Expected: All tests pass.

**Commit:** `feat(tui): accept initial session ID in NewAppModel`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `main.go` to create session before app init

**Verifies:** tui-ux-fix.AC1.1, tui-ux-fix.AC1.3

**Files:**
- Modify: `tui/cmd/constellation-tui/main.go:52-53` (add session creation before app model init)

**Implementation:**

After the protocol version check (line 50) and before `NewAppModel` (line 52), add session creation:

```go
	// Create initial session
	var initialSessionID string
	var createResult protocol.SessionCreateResult
	err = client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &createResult)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to create initial session, falling back to session list: %v\n", err)
	} else {
		initialSessionID = createResult.ID
	}

	appModel := app.NewAppModel(client, proc, initialSessionID)
```

When `session/create` fails, `initialSessionID` remains empty, so `NewAppModel` falls back to `ScreenSessions` (AC1.3).

**Testing:**

This is an imperative shell change (process startup). Verified operationally:
- tui-ux-fix.AC1.1: `just dev` launches directly into chat screen
- tui-ux-fix.AC1.3: If backend is unavailable, TUI falls back to sessions list

The fallback path is also covered by `TestNewAppModel_InitialState` (empty session ID case).

**Verification:**

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

Also update the `backendRestartedMsg` handler in `app.go:122-140` to be consistent with the new startup flow. Currently it hardcodes `ScreenSessions` as the restart target. After this change, it should attempt to create a new session (matching startup behaviour) and fall back to `ScreenSessions` on failure:

```go
case backendRestartedMsg:
    m.client = msg.client
    m.crashed = false
    m.crashErr = ""
    m.chat = nil
    m.tools = nil
    m.secrets = nil
    m.schedules = nil
    m.prompt = nil

    // Try to create a new session (same as startup)
    var createResult protocol.SessionCreateResult
    err := m.client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &createResult)
    if err != nil {
        m.activeScreen = ScreenSessions
        m.screenStack = []ScreenType{ScreenSessions}
        m.sessions = NewSessionsModel(m.client)
        return m, tea.Batch(
            m.sessions.Init(),
            watchBackend(m.backend),
        )
    }
    m.activeScreen = ScreenChat
    m.screenStack = []ScreenType{ScreenChat}
    m.chat = NewChatModel(m.client, createResult.ID)
    return m, tea.Batch(
        m.chat.Init(),
        watchBackend(m.backend),
    )
```

**Commit:** `feat(tui): create session on startup for direct chat launch`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Add `/sessions` and `/new` slash commands

**Verifies:** tui-ux-fix.AC2.1, tui-ux-fix.AC2.3, tui-ux-fix.AC2.4

**Files:**
- Modify: `tui/internal/app/app.go:142-166` (add cases to `SlashCommandMsg` switch)

**Implementation:**

Add `"sessions"` and `"new"` cases to the `SlashCommandMsg` switch in `app.go`:

```go
case SlashCommandMsg:
    switch msg.Command {
    case "sessions":
        if m.sessions == nil {
            m.sessions = NewSessionsModel(m.client)
        }
        m.pushScreen(ScreenSessions)
        return m, m.sessions.Init()
    case "tools":
        m.tools = NewToolsModel(m.client)
        m.pushScreen(ScreenTools)
        return m, m.tools.Init()
    case "secrets":
        m.secrets = NewSecretsModel(m.client)
        m.pushScreen(ScreenSecrets)
        return m, m.secrets.Init()
    case "schedules":
        m.schedules = NewSchedulesModel(m.client)
        m.pushScreen(ScreenSchedules)
        return m, m.schedules.Init()
    case "prompt":
        m.prompt = NewPromptModel(m.client)
        m.pushScreen(ScreenPrompt)
        return m, m.prompt.Init()
    case "new":
        return m, m.createNewSession()
    case "back":
        m.popScreen()
        return m, nil
    case "quit":
        return m, tea.Quit
    }
    return m, nil
```

Add new message type and handler for `/new` session creation:

```go
type newSessionCreatedMsg struct {
	sessionID string
}

type newSessionErrorMsg struct {
	err error
}

func (m *AppModel) createNewSession() tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionCreateResult
		err := m.client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &result)
		if err != nil {
			return newSessionErrorMsg{err: err}
		}
		return newSessionCreatedMsg{sessionID: result.ID}
	}
}
```

Add handler in `Update()` for `newSessionCreatedMsg` (after the `popScreenMsg` case):

```go
case newSessionCreatedMsg:
    m.chat = NewChatModel(m.client, msg.sessionID)
    if m.activeScreen == ScreenChat {
        return m, m.chat.Init()
    }
    m.pushScreen(ScreenChat)
    return m, m.chat.Init()

case newSessionErrorMsg:
    if m.chat != nil {
        m.chat.status = fmt.Sprintf("Error: failed to create session: %v", msg.err)
        m.chat.statusError = true
    }
    return m, nil
```

**Testing:**

Tests must verify:
- tui-ux-fix.AC2.1: `/sessions` pushes `ScreenSessions` onto stack
- tui-ux-fix.AC2.3: `newSessionCreatedMsg` replaces chat model without pushing (when already on chat screen)
- tui-ux-fix.AC2.4: Unknown slash commands return `nil` cmd (no crash)

Add tests:
- `TestAppModel_SlashSessionsPushesScreenSessions`: Send `SlashCommandMsg{Command: "sessions"}` from chat start, verify `activeScreen == ScreenSessions` and stack is `[ScreenChat, ScreenSessions]`
- `TestAppModel_NewSessionReplacesChat`: Start with initial session, send `newSessionCreatedMsg{sessionID: "new-id"}`, verify `chat.sessionID == "new-id"` and stack length unchanged
- `TestAppModel_UnknownSlashCommandIgnored`: Send `SlashCommandMsg{Command: "foo"}`, verify no crash and `cmd == nil`

Follow project pattern: `newMockClient()`, `newMockBackendProcess()`, direct assertions.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestAppModel_Slash|TestAppModel_NewSession|TestAppModel_Unknown"
```

Expected: All tests pass.

**Commit:** `feat(tui): add /sessions and /new slash commands`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update `NavigateToChatMsg` handling to pop sessions screen after selection

**Verifies:** tui-ux-fix.AC3.2, tui-ux-fix.AC3.4

**Files:**
- Modify: `tui/internal/app/app.go:168-172` (change `NavigateToChatMsg` handler)

**Implementation:**

When a session is selected from the sessions list, replace the chat model and pop the sessions screen instead of pushing a new chat screen:

```go
case NavigateToChatMsg:
    m.chat = NewChatModel(m.client, msg.SessionID)
    // Reset stack to chat — session selection always returns to a clean chat root
    m.screenStack = []ScreenType{ScreenChat}
    m.activeScreen = ScreenChat
    return m, m.chat.Init()
```

**Testing:**

Tests must verify:
- tui-ux-fix.AC3.2: Selecting a session from `/sessions` replaces chat and pops sessions screen
- tui-ux-fix.AC3.4: Deep stack unwinds correctly

Add tests:
- `TestAppModel_SessionSelectionPopsSessionsScreen`: Start with initial session (stack `[Chat]`), push sessions (`[Chat, Sessions]`), send `NavigateToChatMsg`, verify stack is `[Chat]` and `chat.sessionID` matches selected session
- `TestAppModel_DeepStackUnwind`: Start with session, push sessions, push tools (stack `[Chat, Sessions, Tools]`), pop (→ `[Chat, Sessions]`), pop (→ `[Chat]`), verify active screen is `ScreenChat`

Follow project testing pattern.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestAppModel_SessionSelection|TestAppModel_DeepStack"
```

Expected: All tests pass.

**Commit:** `feat(tui): pop sessions screen on session selection`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->
<!-- START_TASK_6 -->
### Task 6: Handle escape on chat screen when chat is at stack bottom

**Verifies:** tui-ux-fix.AC3.3

**Files:**
- Modify: `tui/internal/app/app.go:335-340` (update `popScreen` guard)

**Implementation:**

Currently `popScreen()` guards against popping below 1 element. After this change, the stack bottom is `ScreenChat` (not `ScreenSessions`). The guard already works correctly — if there's only `[ScreenChat]` in the stack, `popScreen()` is a no-op, which is correct behaviour (escape on the root chat does nothing).

No code change needed to `popScreen()` — the guard `len(m.screenStack) > 1` already prevents popping below the root regardless of which screen type is at the bottom.

**Testing:**

Tests must verify:
- tui-ux-fix.AC3.3: After `/new`, escape from chat is a no-op (no orphaned stack entries)

Add test `TestAppModel_EscapeOnRootChatDoesNothing`:
- Create app with initial session (stack `[Chat]`)
- Send `popScreenMsg{}`
- Verify stack is still `[Chat]` and `activeScreen == ScreenChat`

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestAppModel_EscapeOnRootChat"
```

Expected: Test passes.

**Commit:** `test(tui): verify escape on root chat is no-op`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Run full test suite and verify all Phase 1 changes

**Verifies:** tui-ux-fix.AC1.1, tui-ux-fix.AC1.2, tui-ux-fix.AC2.1, tui-ux-fix.AC2.2, tui-ux-fix.AC2.3, tui-ux-fix.AC2.4, tui-ux-fix.AC3.1, tui-ux-fix.AC3.2, tui-ux-fix.AC3.3, tui-ux-fix.AC3.4

**Files:**
- No modifications — verification only

**Verification:**

```bash
cd tui && go test ./...
```

Expected: All tests pass, including both existing tests (updated for `popScreenMsg` rename and `NewAppModel` signature change) and new tests added in tasks 2, 4, 5, and 6.

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

**Commit:** No commit — verification step only.
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_C -->
