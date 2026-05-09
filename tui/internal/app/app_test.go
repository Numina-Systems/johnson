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

	app := NewAppModel(client, backend)

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

func TestAppModel_CtrlTPushesScreenTools(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend)

	// Create a ctrl+t key message
	msg := tea.KeyPressMsg(tea.Key{Code: 't', Mod: tea.ModCtrl})
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

func TestAppModel_CtrlSPushesScreenSecrets(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend)

	msg := tea.KeyPressMsg(tea.Key{Code: 's', Mod: tea.ModCtrl})
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

func TestAppModel_CtrlDPushesScreenSchedules(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend)

	msg := tea.KeyPressMsg(tea.Key{Code: 'd', Mod: tea.ModCtrl})
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

func TestAppModel_CtrlPPushesScreenPrompt(t *testing.T) {
	client := newMockClient()
	backend := newMockBackendProcess()
	app := NewAppModel(client, backend)

	msg := tea.KeyPressMsg(tea.Key{Code: 'p', Mod: tea.ModCtrl})
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
	app := NewAppModel(client, backend)

	// Push ScreenTools
	msg := tea.KeyPressMsg(tea.Key{Code: 't', Mod: tea.ModCtrl})
	_, _ = app.Update(msg)

	if app.activeScreen != ScreenTools {
		t.Errorf("before escape: activeScreen got %v, want ScreenTools", app.activeScreen)
	}

	// The ScreenTools model handles escape key and returns a backToSessionsMsg
	// We need to send that message to app for it to pop the screen
	escapeMsg := backToSessionsMsg{}
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
	app := NewAppModel(client, backend)

	// Push ScreenTools
	toolsMsg := tea.KeyPressMsg(tea.Key{Code: 't', Mod: tea.ModCtrl})
	_, _ = app.Update(toolsMsg)

	// Push ScreenSecrets
	secretsMsg := tea.KeyPressMsg(tea.Key{Code: 's', Mod: tea.ModCtrl})
	_, _ = app.Update(secretsMsg)

	if len(app.screenStack) != 3 {
		t.Errorf("after pushing 2 screens: screenStack length got %d, want 3", len(app.screenStack))
	}

	expectedStack := []ScreenType{ScreenSessions, ScreenTools, ScreenSecrets}
	for i, expected := range expectedStack {
		if app.screenStack[i] != expected {
			t.Errorf("screenStack[%d]: got %v, want %v", i, app.screenStack[i], expected)
		}
	}

	// Pop back to Tools using backToSessionsMsg
	escapeMsg := backToSessionsMsg{}
	_, _ = app.Update(escapeMsg)

	if app.activeScreen != ScreenTools {
		t.Errorf("after first escape: activeScreen got %v, want ScreenTools", app.activeScreen)
	}

	if len(app.screenStack) != 2 {
		t.Errorf("after first escape: screenStack length got %d, want 2", len(app.screenStack))
	}

	// Pop back to Sessions
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
	app := NewAppModel(client, backend)

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
	app := NewAppModel(client, backend)

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
	app := NewAppModel(client, backend)

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
	app := NewAppModel(client, backend)

	// We're already at ScreenSessions (root)
	if app.activeScreen != ScreenSessions {
		t.Errorf("setup: activeScreen got %v, want ScreenSessions", app.activeScreen)
	}

	// Send backToSessionsMsg at root (popScreen prevents popping below ScreenSessions)
	escapeMsg := backToSessionsMsg{}
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

// Helper function to check if a string contains a substring
func contains(haystack, needle string) bool {
	for i := 0; i <= len(haystack)-len(needle); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
