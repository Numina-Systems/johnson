// pattern: Imperative Shell (test)
package app

import (
	"constellation-tui/internal/backend"
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	"io"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// nopWriteCloser wraps io.Writer to implement io.WriteCloser with a no-op Close.
type nopWriteCloser struct {
	io.Writer
}

func (nopWriteCloser) Close() error { return nil }

// nopReadCloser wraps io.Reader to implement io.ReadCloser with a no-op Close.
type nopReadCloser struct {
	io.Reader
}

func (nopReadCloser) Close() error { return nil }

func newMockClient() *protocol.Client {
	// Create null pipes that don't block. The client will accept these
	// and use them for communication, but we won't actually send/receive.
	nullReader := nopReadCloser{io.Reader(io.LimitReader(io.Reader(nil), 0))}
	nullWriter := nopWriteCloser{io.Writer(io.Discard)}

	ctx := context.Background()
	client, err := protocol.NewClient(ctx, nullReader, nullWriter)
	if err != nil {
		// In tests, we'll just use a panic since this is a test helper
		panic(fmt.Sprintf("failed to create mock client: %v", err))
	}
	return client
}

func newMockBackendProcess() *backend.BackendProcess {
	return &backend.BackendProcess{}
}

func TestNewAppModel_InitialState(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()

	app := NewAppModel(client, backend, "", nil)

	if app.activeScreen != ScreenSessions {
		t.Errorf("activeScreen: got %v, want ScreenSessions", app.activeScreen)
	}

	if len(app.screenStack) != 1 || app.screenStack[0] != ScreenSessions {
		t.Errorf("screenStack: got %v, want [ScreenSessions]", app.screenStack)
	}

	if app.crashed {
		t.Errorf("crashed: got true, want false")
	}

	if app.sessions == nil {
		t.Errorf("sessions: got nil, want initialized SessionsModel")
	}
}

func TestAppModel_SlashToolsPushesScreenTools(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "tools"}
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenTools {
		t.Errorf("activeScreen: got %v, want ScreenTools", app.activeScreen)
	}

	if len(app.screenStack) != 2 || app.screenStack[1] != ScreenTools {
		t.Errorf("screenStack: got %v, want [ScreenSessions, ScreenTools]", app.screenStack)
	}

	if app.tools == nil {
		t.Errorf("tools: got nil, want initialized ToolsModel")
	}
}

func TestAppModel_SlashSecretsPushesScreenSecrets(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "secrets"}
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenSecrets {
		t.Errorf("activeScreen: got %v, want ScreenSecrets", app.activeScreen)
	}

	if len(app.screenStack) != 2 || app.screenStack[1] != ScreenSecrets {
		t.Errorf("screenStack: got %v, want [ScreenSessions, ScreenSecrets]", app.screenStack)
	}

	if app.secrets == nil {
		t.Errorf("secrets: got nil, want initialized SecretsModel")
	}
}

func TestAppModel_SlashSchedulesPushesScreenSchedules(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "schedules"}
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenSchedules {
		t.Errorf("activeScreen: got %v, want ScreenSchedules", app.activeScreen)
	}

	if len(app.screenStack) != 2 || app.screenStack[1] != ScreenSchedules {
		t.Errorf("screenStack: got %v, want [ScreenSessions, ScreenSchedules]", app.screenStack)
	}

	if app.schedules == nil {
		t.Errorf("schedules: got nil, want initialized SchedulesModel")
	}
}

func TestAppModel_SlashPromptPushesScreenPrompt(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "prompt"}
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenPrompt {
		t.Errorf("activeScreen: got %v, want ScreenPrompt", app.activeScreen)
	}

	if len(app.screenStack) != 2 || app.screenStack[1] != ScreenPrompt {
		t.Errorf("screenStack: got %v, want [ScreenSessions, ScreenPrompt]", app.screenStack)
	}

	if app.prompt == nil {
		t.Errorf("prompt: got nil, want initialized PromptModel")
	}
}

func TestAppModel_EscapePopScreen(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	// Push ScreenTools via slash command
	_, _ = app.Update(SlashCommandMsg{Command: "tools"})

	if app.activeScreen != ScreenTools {
		t.Errorf("before escape: activeScreen got %v, want ScreenTools", app.activeScreen)
	}

	escapeMsg := popScreenMsg{}
	_, _ = app.Update(escapeMsg)

	if app.activeScreen != ScreenSessions {
		t.Errorf("after escape: activeScreen got %v, want ScreenSessions", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("after escape: screenStack length got %d, want 1", len(app.screenStack))
	}
}

func TestAppModel_ScreenStackMaintainsHistory(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	// Push ScreenTools via slash command
	_, _ = app.Update(SlashCommandMsg{Command: "tools"})

	// Push ScreenSecrets via slash command
	_, _ = app.Update(SlashCommandMsg{Command: "secrets"})

	if len(app.screenStack) != 3 {
		t.Errorf("after pushing 2 screens: screenStack length got %d, want 3", len(app.screenStack))
	}

	expectedStack := []ScreenType{ScreenSessions, ScreenTools, ScreenSecrets}
	for i, expected := range expectedStack {
		if app.screenStack[i] != expected {
			t.Errorf("screenStack[%d]: got %v, want %v", i, app.screenStack[i], expected)
		}
	}

	escapeMsg := popScreenMsg{}
	_, _ = app.Update(escapeMsg)

	if app.activeScreen != ScreenTools {
		t.Errorf("after first escape: activeScreen got %v, want ScreenTools", app.activeScreen)
	}

	if len(app.screenStack) != 2 {
		t.Errorf("after first escape: screenStack length got %d, want 2", len(app.screenStack))
	}

	_, _ = app.Update(escapeMsg)

	if app.activeScreen != ScreenSessions {
		t.Errorf("after second escape: activeScreen got %v, want ScreenSessions", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("after second escape: screenStack length got %d, want 1", len(app.screenStack))
	}
}

func TestAppModel_BackendCrashedSetsFlag(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	testErr := fmt.Errorf("connection refused")
	msg := backendCrashedMsg{err: testErr}
	_, _ = app.Update(msg)

	if !app.crashed {
		t.Errorf("crashed: got false, want true")
	}

	if app.crashErr != testErr.Error() {
		t.Errorf("crashErr: got %q, want %q", app.crashErr, testErr.Error())
	}
}

func TestAppModel_CrashRecoveryViewShowsText(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	testErr := fmt.Errorf("backend error")
	msg := backendCrashedMsg{err: testErr}
	_, _ = app.Update(msg)

	view := app.View()
	viewText := view.Content

	expectedStrings := []string{
		"Backend process exited unexpectedly",
		"backend error",
		"Press 'r' to restart",
		"'q' to quit",
	}

	for _, expected := range expectedStrings {
		if !contains(viewText, expected) {
			t.Errorf("view text missing: %q\nGot:\n%s", expected, viewText)
		}
	}
}

func TestAppModel_CtrlCQuits(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl})
	_, cmd := app.Update(msg)

	// Check that cmd is tea.Quit
	if cmd == nil {
		t.Errorf("cmd: got nil, want tea.Quit")
	}

	// Execute the command and check its output
	result := cmd()
	if _, ok := result.(tea.QuitMsg); !ok {
		t.Errorf("cmd result: got %T, want tea.QuitMsg", result)
	}
}

func TestAppModel_EscapeAtRootDoesNothing(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	// We're already at ScreenSessions (root)
	if app.activeScreen != ScreenSessions {
		t.Errorf("setup: activeScreen got %v, want ScreenSessions", app.activeScreen)
	}

	// Send popScreenMsg at root (popScreen prevents popping below ScreenSessions)
	escapeMsg := popScreenMsg{}
	_, _ = app.Update(escapeMsg)

	// Should still be at ScreenSessions
	if app.activeScreen != ScreenSessions {
		t.Errorf("activeScreen: got %v, want ScreenSessions", app.activeScreen)
	}

	// Stack should still have exactly one element
	if len(app.screenStack) != 1 {
		t.Errorf("screenStack length: got %d, want 1", len(app.screenStack))
	}
}

func TestNewAppModel_WithInitialSession(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()

	app := NewAppModel(client, backend, "test-session-123", nil)

	if app.activeScreen != ScreenChat {
		t.Errorf("activeScreen: got %v, want ScreenChat", app.activeScreen)
	}

	if len(app.screenStack) != 1 || app.screenStack[0] != ScreenChat {
		t.Errorf("screenStack: got %v, want [ScreenChat]", app.screenStack)
	}

	if app.chat == nil {
		t.Errorf("chat: got nil, want initialized ChatModel")
	}

	if app.chat.sessionID != "test-session-123" {
		t.Errorf("chat.sessionID: got %q, want 'test-session-123'", app.chat.sessionID)
	}

	if app.sessions != nil {
		t.Errorf("sessions: got initialized, want nil when starting with session")
	}
}

func TestAppModel_SlashSessionsPushesScreenSessions(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	if app.activeScreen != ScreenChat {
		t.Errorf("setup: activeScreen got %v, want ScreenChat", app.activeScreen)
	}

	msg := SlashCommandMsg{Command: "sessions"}
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenSessions {
		t.Errorf("activeScreen: got %v, want ScreenSessions", app.activeScreen)
	}

	if len(app.screenStack) != 2 || app.screenStack[1] != ScreenSessions {
		t.Errorf("screenStack: got %v, want [ScreenChat, ScreenSessions]", app.screenStack)
	}

	if app.sessions == nil {
		t.Errorf("sessions: got nil, want initialized SessionsModel")
	}
}

func TestAppModel_NewSessionReplacesChat(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	initialStackLen := len(app.screenStack)

	msg := newSessionCreatedMsg{sessionID: "new-session-id"}
	_, _ = app.Update(msg)

	if app.chat == nil {
		t.Errorf("chat: got nil, want initialized ChatModel")
	}

	if app.chat.sessionID != "new-session-id" {
		t.Errorf("chat.sessionID: got %q, want 'new-session-id'", app.chat.sessionID)
	}

	if len(app.screenStack) != initialStackLen {
		t.Errorf("screenStack length: got %d, want %d (should not push)", len(app.screenStack), initialStackLen)
	}
}

func TestAppModel_UnknownSlashCommandIgnored(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "foo"}
	_, cmd := app.Update(msg)

	if cmd != nil {
		t.Errorf("cmd: got non-nil, want nil for unknown command")
	}

	if app.activeScreen != ScreenSessions {
		t.Errorf("activeScreen: got %v, want ScreenSessions (unchanged)", app.activeScreen)
	}
}

func TestAppModel_SessionSelectionPopsSessionsScreen(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	// Push sessions
	msg := SlashCommandMsg{Command: "sessions"}
	_, _ = app.Update(msg)

	if len(app.screenStack) != 2 {
		t.Errorf("setup: screenStack length got %d, want 2", len(app.screenStack))
	}

	// Select a session
	navMsg := NavigateToChatMsg{SessionID: "selected-session-id"}
	_, _ = app.Update(navMsg)

	if len(app.screenStack) != 1 {
		t.Errorf("screenStack length: got %d, want 1 (sessions popped)", len(app.screenStack))
	}

	if app.screenStack[0] != ScreenChat {
		t.Errorf("screenStack[0]: got %v, want ScreenChat", app.screenStack[0])
	}

	if app.chat.sessionID != "selected-session-id" {
		t.Errorf("chat.sessionID: got %q, want 'selected-session-id'", app.chat.sessionID)
	}
}

func TestAppModel_DeepStackUnwind(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	// Stack: [Chat]
	if len(app.screenStack) != 1 {
		t.Errorf("setup: screenStack length got %d, want 1", len(app.screenStack))
	}

	// Push sessions: [Chat, Sessions]
	_, _ = app.Update(SlashCommandMsg{Command: "sessions"})
	if len(app.screenStack) != 2 {
		t.Errorf("after sessions: screenStack length got %d, want 2", len(app.screenStack))
	}

	// Push tools: [Chat, Sessions, Tools]
	_, _ = app.Update(SlashCommandMsg{Command: "tools"})
	if len(app.screenStack) != 3 {
		t.Errorf("after tools: screenStack length got %d, want 3", len(app.screenStack))
	}

	// Pop (escape): [Chat, Sessions]
	_, _ = app.Update(popScreenMsg{})
	if app.activeScreen != ScreenSessions {
		t.Errorf("after pop 1: activeScreen got %v, want ScreenSessions", app.activeScreen)
	}

	if len(app.screenStack) != 2 {
		t.Errorf("after pop 1: screenStack length got %d, want 2", len(app.screenStack))
	}

	// Pop (escape): [Chat]
	_, _ = app.Update(popScreenMsg{})
	if app.activeScreen != ScreenChat {
		t.Errorf("after pop 2: activeScreen got %v, want ScreenChat", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("after pop 2: screenStack length got %d, want 1", len(app.screenStack))
	}
}

func TestAppModel_EscapeOnRootChatDoesNothing(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	if app.activeScreen != ScreenChat {
		t.Errorf("setup: activeScreen got %v, want ScreenChat", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("setup: screenStack length got %d, want 1", len(app.screenStack))
	}

	_, _ = app.Update(popScreenMsg{})

	if app.activeScreen != ScreenChat {
		t.Errorf("activeScreen: got %v, want ScreenChat (unchanged)", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("screenStack length: got %d, want 1 (unchanged)", len(app.screenStack))
	}
}

func TestAppModel_WindowSizeMsg_WithInitialSession(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	if app.sessions != nil {
		t.Errorf("sessions: got initialized, want nil (app started with initial session)")
	}

	if app.chat == nil {
		t.Errorf("chat: got nil, want initialized ChatModel")
	}

	msg := tea.WindowSizeMsg{Width: 120, Height: 40}
	_, _ = app.Update(msg)

	if app.width != 120 {
		t.Errorf("app.width: got %d, want 120", app.width)
	}

	if app.height != 40 {
		t.Errorf("app.height: got %d, want 40", app.height)
	}

	if app.chat.width != 120 {
		t.Errorf("chat.width: got %d, want 120", app.chat.width)
	}

	if app.chat.height != 40 {
		t.Errorf("chat.height: got %d, want 40", app.chat.height)
	}

	if app.sessions != nil {
		t.Errorf("sessions: got initialized, want nil (should remain nil)")
	}
}

func TestAppModel_SlashBackPopsScreen(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "test-session-123", nil)

	// Push a screen (e.g., tools)
	_, _ = app.Update(SlashCommandMsg{Command: "tools"})

	if app.activeScreen != ScreenTools {
		t.Errorf("setup: activeScreen got %v, want ScreenTools", app.activeScreen)
	}

	// Send /back slash command
	_, _ = app.Update(SlashCommandMsg{Command: "back"})

	if app.activeScreen != ScreenChat {
		t.Errorf("activeScreen: got %v, want ScreenChat", app.activeScreen)
	}

	if len(app.screenStack) != 1 {
		t.Errorf("screenStack length: got %d, want 1", len(app.screenStack))
	}
}

func TestAppModel_SlashQuitReturnsCmd(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "quit"}
	_, cmd := app.Update(msg)

	if cmd == nil {
		t.Errorf("cmd: got nil, want tea.Quit")
	}

	result := cmd()
	if _, ok := result.(tea.QuitMsg); !ok {
		t.Errorf("cmd result: got %T, want tea.QuitMsg", result)
	}
}

func TestAppModel_SlashNewReturnsCmd(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend, "", nil)

	msg := SlashCommandMsg{Command: "new"}
	_, cmd := app.Update(msg)

	if cmd == nil {
		t.Errorf("cmd: got nil, want async RPC trigger command")
	}
}

// Helper function to check if a string contains a substring
func contains(haystack, needle string) bool {
	for i := 0; i <= len(haystack)-len(needle); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
