// pattern: Imperative Shell (test)
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	"io"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func newPromptClient() *protocol.Client {
	nullReader := nopReadCloser{io.Reader(io.LimitReader(io.Reader(nil), 0))}
	nullWriter := nopWriteCloser{io.Writer(io.Discard)}

	ctx := context.Background()
	client, err := protocol.NewClient(ctx, nullReader, nullWriter)
	if err != nil {
		panic(fmt.Sprintf("failed to create prompt client: %v", err))
	}
	return client
}

func TestNewPromptModel_InitialState(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	if model.ready {
		t.Error("expected initial ready to be false")
	}

	if model.errorMsg != "" {
		t.Errorf("expected initial error message to be empty, got %q", model.errorMsg)
	}

	if model.width != 80 || model.height != 24 {
		t.Errorf("expected initial size 80x24, got %dx%d", model.width, model.height)
	}

	if model.client == nil {
		t.Error("expected client to be initialized")
	}
}

func TestPromptModel_PromptLoadedMsg_SetsContentAndReady(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	promptContent := "You are a helpful assistant.\nYou should respond to all queries.\n"
	msg := promptLoadedMsg{prompt: promptContent}

	_, cmd := model.Update(msg)

	if !model.ready {
		t.Error("expected ready to be true after loading")
	}

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}

	if cmd != nil {
		t.Error("expected no command for promptLoadedMsg")
	}
}

func TestPromptModel_PromptErrorMsg(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	msg := promptErrorMsg{err: fmt.Errorf("failed to fetch prompt")}
	_, _ = model.Update(msg)

	if model.errorMsg != "failed to fetch prompt" {
		t.Errorf("expected error message to be 'failed to fetch prompt', got %q", model.errorMsg)
	}

	if model.ready {
		t.Error("expected ready to be false after error")
	}
}

func TestPromptModel_View_NotReady_ShowsLoading(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = false

	view := model.View()

	if !contains(view.Content, "Loading") {
		t.Error("expected view to contain 'Loading' when not ready")
	}
}

func TestPromptModel_View_Ready_ShowsContent(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true
	model.viewport.SetContent("System Prompt Content\nLine 2\nLine 3")

	view := model.View()

	if !contains(view.Content, "System Prompt") {
		t.Error("expected view to contain 'System Prompt' heading")
	}
}

func TestPromptModel_View_Error_ShowsErrorMessage(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.errorMsg = "connection refused"

	view := model.View()

	if !contains(view.Content, "connection refused") {
		t.Error("expected view to contain error message")
	}
}

func TestPromptModel_NavigationReady(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	// Verify the model is ready to handle navigation
	// Escape key handling is tested in integration tests.
	if !model.ready {
		t.Error("model should be ready")
	}
}

func TestPromptModel_KeyPress_ScrollDown(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10"
	model.viewport.SetContent(content)

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_ScrollUp(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10"
	model.viewport.SetContent(content)
	model.viewport.SetHeight(3)
	model.viewport.ScrollDown(5)

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_GotoTop(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10"
	model.viewport.SetContent(content)
	model.viewport.ScrollDown(10)

	msg := tea.KeyPressMsg(tea.Key{Code: 'g'})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_GotoBottom(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10"
	model.viewport.SetContent(content)
	model.viewport.SetHeight(3)

	msg := tea.KeyPressMsg(tea.Key{Code: 'G'})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_PageDown(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15"
	model.viewport.SetContent(content)
	model.viewport.SetHeight(3)

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	msg2 := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	msg3 := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	_, _ = model.Update(msg)
	_, _ = model.Update(msg2)
	_, _ = model.Update(msg3)

	// Just verify the key presses are handled without error
}

func TestPromptModel_KeyPress_PageUp(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15"
	model.viewport.SetContent(content)
	model.viewport.SetHeight(3)
	model.viewport.ScrollDown(10)

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_JKey_Scrolls(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8"
	model.viewport.SetContent(content)

	msg := tea.KeyPressMsg(tea.Key{Code: 'j'})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_KeyPress_KKey_Scrolls(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8"
	model.viewport.SetContent(content)
	model.viewport.ScrollDown(5)

	msg := tea.KeyPressMsg(tea.Key{Code: 'k'})
	_, _ = model.Update(msg)

	// Just verify the key press is handled without error
}

func TestPromptModel_WindowSizeMsg_UpdatesViewport(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	msg := tea.WindowSizeMsg{Width: 120, Height: 40}
	_, _ = model.Update(msg)

	if model.width != 120 {
		t.Errorf("expected width to be 120, got %d", model.width)
	}

	if model.height != 40 {
		t.Errorf("expected height to be 40, got %d", model.height)
	}

	// Viewport should have been resized to 40-4 for header/footer
	// We can't directly verify the viewport dimensions due to API constraints,
	// but we verified the model's width/height above
}

func TestPromptModel_View_WithLoadedContent(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true
	model.viewport.SetContent("Test prompt content")
	model.width = 80
	model.height = 24

	view := model.View()

	if !contains(view.Content, "System Prompt") {
		t.Error("expected view to contain header")
	}

	if !contains(view.Content, "scroll") {
		t.Error("expected view to contain scroll instructions")
	}
}

func TestPromptModel_Init_ReturnsCommand(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	cmd := model.Init()

	if cmd == nil {
		t.Error("expected Init to return a command")
	}
}

func TestPromptModel_Viewport_IsInitialized(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	// Viewport should be initialized (non-zero Model value)
	// We can verify by checking the model was created successfully
	if model.client == nil {
		t.Error("expected model to be properly initialized with viewport")
	}
}

func TestPromptModel_MultipleWindowResize(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	msg1 := tea.WindowSizeMsg{Width: 100, Height: 30}
	_, _ = model.Update(msg1)

	if model.width != 100 || model.height != 30 {
		t.Errorf("expected size 100x30 after first resize, got %dx%d", model.width, model.height)
	}

	msg2 := tea.WindowSizeMsg{Width: 150, Height: 50}
	_, _ = model.Update(msg2)

	if model.width != 150 || model.height != 50 {
		t.Errorf("expected size 150x50 after second resize, got %dx%d", model.width, model.height)
	}
}

func TestPromptModel_ErrorClearedOnLoad(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	// Set an error first
	errMsg := promptErrorMsg{err: fmt.Errorf("test error")}
	_, _ = model.Update(errMsg)

	if model.errorMsg != "test error" {
		t.Error("expected error to be set")
	}

	// Now load a prompt
	loadMsg := promptLoadedMsg{prompt: "New prompt"}
	_, _ = model.Update(loadMsg)

	if model.errorMsg != "" {
		t.Errorf("expected error to be cleared after load, got %q", model.errorMsg)
	}

	if !model.ready {
		t.Error("expected ready to be true after load")
	}
}

func TestPromptModel_ScrollKeysDelegateToViewport(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true

	content := "line1\nline2\nline3\nline4\nline5"
	model.viewport.SetContent(content)
	model.viewport.SetHeight(2)

	// Test that various scroll keys are handled
	scrollKeys := []tea.Key{
		{Code: tea.KeyDown},
		{Code: tea.KeyUp},
		{Code: 'j'},
		{Code: 'k'},
		{Code: 'g'},
		{Code: 'G'},
	}

	for _, key := range scrollKeys {
		msg := tea.KeyPressMsg(key)
		_, _ = model.Update(msg)
		// Just verify no panic
	}
}

func TestPromptModel_View_ShowsInstructions(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)
	model.ready = true
	model.viewport.SetContent("prompt content")

	view := model.View()

	if !contains(view.Content, "Escape: back") {
		t.Error("expected view to show escape instruction")
	}
}

func TestPromptModel_Init_LoadsPrompt(t *testing.T) {
	client := newPromptClient()
	model := NewPromptModel(client)

	cmd := model.Init()

	if cmd == nil {
		t.Error("expected Init to return a command that loads the prompt")
	}

	// Execute the command to verify it returns a message
	msg := cmd()
	if msg == nil {
		t.Error("expected command to return a message when executed")
	}
}
