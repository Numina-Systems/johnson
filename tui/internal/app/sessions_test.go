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

func newSessionsClient() *protocol.Client {
	nullReader := nopReadCloser{io.Reader(io.LimitReader(io.Reader(nil), 0))}
	nullWriter := nopWriteCloser{io.Writer(io.Discard)}

	ctx := context.Background()
	client, err := protocol.NewClient(ctx, nullReader, nullWriter)
	if err != nil {
		panic(fmt.Sprintf("failed to create sessions client: %v", err))
	}
	return client
}

func TestNewSessionsModel_InitialState(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	if len(model.list.Items()) != 0 {
		t.Errorf("expected initial list items to be empty, got %d", len(model.list.Items()))
	}

	if model.errorMsg != "" {
		t.Errorf("expected initial error message to be empty, got %q", model.errorMsg)
	}

	if model.width != 80 || model.height != 24 {
		t.Errorf("expected initial size 80x24, got %dx%d", model.width, model.height)
	}
}

func TestSessionsModel_SessionsLoadedMsg_PopulatesListItems(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	title1 := "Session 1"
	title2 := "Session 2"
	msg := sessionsLoadedMsg{
		sessions: []protocol.SessionRow{
			{
				ID:           "sess-1",
				Title:        &title1,
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 5,
			},
			{
				ID:           "sess-2",
				Title:        &title2,
				UpdatedAt:    "2026-05-09T11:00:00Z",
				MessageCount: 3,
			},
		},
	}

	_, _ = model.Update(msg)

	if len(model.list.Items()) != 2 {
		t.Errorf("expected 2 items after load, got %d", len(model.list.Items()))
	}

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}

	item1, ok := model.list.Items()[0].(sessionItem)
	if !ok {
		t.Fatal("expected first item to be sessionItem")
	}

	if item1.id != "sess-1" {
		t.Errorf("expected first item id to be 'sess-1', got %q", item1.id)
	}

	if item1.title == nil || *item1.title != "Session 1" {
		t.Errorf("expected first item title to be 'Session 1', got %v", item1.title)
	}
}

func TestSessionsModel_SessionCreatedMsg_TriggersRefresh(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	msg := sessionCreatedMsg{id: "new-session"}

	_, cmd := model.Update(msg)

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}

	if cmd == nil {
		t.Error("expected command to be returned")
	}
}

func TestSessionsModel_SessionDeletedMsg_TriggersRefresh(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	msg := sessionDeletedMsg{}

	_, cmd := model.Update(msg)

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}

	if cmd == nil {
		t.Error("expected command to be returned")
	}
}

func TestSessionsModel_SessionsErrorMsg_SetsErrorMessage(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	testErr := fmt.Errorf("connection timeout")
	msg := sessionsErrorMsg{err: testErr}

	_, _ = model.Update(msg)

	if model.errorMsg != "connection timeout" {
		t.Errorf("expected error message 'connection timeout', got %q", model.errorMsg)
	}
}

func TestSessionsModel_SessionsLoadedMsg_ClearsErrorMessage(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	// Set an error first
	testErr := fmt.Errorf("some error")
	errMsg := sessionsErrorMsg{err: testErr}
	_, _ = model.Update(errMsg)

	if model.errorMsg != "some error" {
		t.Errorf("setup: expected error message, got %q", model.errorMsg)
	}

	// Now load sessions successfully
	title := "Session A"
	loadMsg := sessionsLoadedMsg{
		sessions: []protocol.SessionRow{
			{
				ID:           "sess-a",
				Title:        &title,
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 1,
			},
		},
	}

	_, _ = model.Update(loadMsg)

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}
}

func TestSessionsModel_EnterKey_NavigatesToChat(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	title := "Test Session"
	loadMsg := sessionsLoadedMsg{
		sessions: []protocol.SessionRow{
			{
				ID:           "sess-123",
				Title:        &title,
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 2,
			},
		},
	}

	_, _ = model.Update(loadMsg)

	keyMsg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})
	_, cmd := model.Update(keyMsg)

	if cmd == nil {
		t.Error("expected command to be returned for enter key")
	}

	// Execute command and check result
	result := cmd()
	navMsg, ok := result.(NavigateToChatMsg)
	if !ok {
		t.Errorf("expected NavigateToChatMsg, got %T", result)
	}

	if navMsg.SessionID != "sess-123" {
		t.Errorf("expected SessionID 'sess-123', got %q", navMsg.SessionID)
	}
}

func TestSessionsModel_NKey_CreatesSession(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	keyMsg := tea.KeyPressMsg(tea.Key{Code: 'n'})
	_, cmd := model.Update(keyMsg)

	if cmd == nil {
		t.Error("expected command to be returned for 'n' key")
	}
}

func TestSessionsModel_DKey_DeletesSession(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	title := "Session to Delete"
	loadMsg := sessionsLoadedMsg{
		sessions: []protocol.SessionRow{
			{
				ID:           "sess-delete",
				Title:        &title,
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 1,
			},
		},
	}

	_, _ = model.Update(loadMsg)

	keyMsg := tea.KeyPressMsg(tea.Key{Code: 'd'})
	_, cmd := model.Update(keyMsg)

	if cmd == nil {
		t.Error("expected command to be returned for 'd' key")
	}
}

func TestSessionsModel_WindowResize_UpdatesListDimensions(t *testing.T) {
	client := newSessionsClient()
	model := NewSessionsModel(client)

	msg := tea.WindowSizeMsg{
		Width:  120,
		Height: 40,
	}

	_, _ = model.Update(msg)

	if model.width != 120 {
		t.Errorf("expected width to be 120, got %d", model.width)
	}

	if model.height != 40 {
		t.Errorf("expected height to be 40, got %d", model.height)
	}
}

func TestSessionsModel_SessionItem_TitleWithNilShowsUntitled(t *testing.T) {
	item := sessionItem{
		id:           "sess-1",
		title:        nil,
		updatedAt:    "2026-05-09T12:00:00Z",
		messageCount: 0,
	}

	if item.Title() != "Untitled session" {
		t.Errorf("expected 'Untitled session', got %q", item.Title())
	}
}

func TestSessionsModel_SessionItem_DescriptionFormats(t *testing.T) {
	title := "My Session"
	item := sessionItem{
		id:           "sess-1",
		title:        &title,
		updatedAt:    "2026-05-09T12:00:00Z",
		messageCount: 5,
	}

	desc := item.Description()
	if desc != "5 messages · 2026-05-09T12:00:00Z" {
		t.Errorf("expected specific description format, got %q", desc)
	}
}
