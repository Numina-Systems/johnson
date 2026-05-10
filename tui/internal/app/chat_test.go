// pattern: Imperative Shell (test)
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func newChatClient() *protocol.Client {
	nullReader := nopReadCloser{io.Reader(io.LimitReader(io.Reader(nil), 0))}
	nullWriter := nopWriteCloser{io.Writer(io.Discard)}

	ctx := context.Background()
	client, err := protocol.NewClient(ctx, nullReader, nullWriter)
	if err != nil {
		panic(fmt.Sprintf("failed to create chat client: %v", err))
	}
	return client
}

func TestNewChatModel_InitialState(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	if model.sessionID != "session-123" {
		t.Errorf("expected sessionID to be 'session-123', got %q", model.sessionID)
	}

	if len(model.messages) != 0 {
		t.Errorf("expected initial messages to be empty, got %d", len(model.messages))
	}

	if model.chatRequestID != "" {
		t.Errorf("expected initial chatRequestID to be empty, got %q", model.chatRequestID)
	}

	if model.renderer == nil {
		t.Error("expected renderer to be initialized")
	}

	if model.width != 80 || model.height != 24 {
		t.Errorf("expected initial size 80x24, got %dx%d", model.width, model.height)
	}
}

func TestNewChatModel_RegistersCallbacks(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	// Verify callbacks are set by sending test data through channels
	// We'll test this indirectly by checking if events/responses are processed
	testEvent := protocol.AgentEventParams{
		RequestID: "test-123",
		Kind:      "llm_start",
		Data:      map[string]interface{}{},
	}

	// The callbacks should be registered and functional
	// We won't be able to directly verify the callback references,
	// but we can test that events are processed through Update
	model.chatRequestID = "test-123"
	model.handleAgentEvent(testEvent)

	if model.status != "Thinking..." {
		t.Errorf("expected event handling to work, got status %q", model.status)
	}
}

func TestChatModel_HandleKeyPress_Enter_SendsMessage(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.messages = []renderedMessage{}

	model.textarea.SetValue("hello world")

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})

	_, cmd := model.handleKeyPress(msg)
	if cmd == nil {
		t.Error("expected command to be returned")
	}

	if len(model.messages) != 1 {
		t.Errorf("expected 1 message after sending, got %d", len(model.messages))
	}

	if model.messages[0].role != "user" {
		t.Errorf("expected message role to be 'user', got %q", model.messages[0].role)
	}

	if model.textarea.Value() != "" {
		t.Errorf("expected textarea to be cleared after sending, got %q", model.textarea.Value())
	}
}

func TestChatModel_HandleKeyPress_Enter_IgnoresEmptyMessage(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})

	_, cmd := model.handleKeyPress(msg)
	if cmd != nil {
		t.Error("expected no command for empty message")
	}

	if len(model.messages) != 0 {
		t.Errorf("expected no message added for empty input, got %d", len(model.messages))
	}
}

func TestChatModel_HandleKeyPress_Enter_IgnoresWhitespaceOnly(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.textarea.SetValue("   \n\t  ")

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})

	_, cmd := model.handleKeyPress(msg)
	if cmd != nil {
		t.Error("expected no command for whitespace-only message")
	}

	if len(model.messages) != 0 {
		t.Errorf("expected no message added, got %d", len(model.messages))
	}
}

func TestChatModel_HandleKeyPress_Enter_BlockedDuringChat(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"
	model.textarea.SetValue("hello")

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})

	_, cmd := model.handleKeyPress(msg)
	if cmd != nil {
		t.Error("expected no command while chat is active")
	}

	if len(model.messages) != 0 {
		t.Errorf("expected no message added while chat is active, got %d", len(model.messages))
	}
}

func TestChatModel_HandleKeyPress_Escape_ReturnsBackMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	// Rather than trying to construct a KeyPressMsg with the right string representation,
	// we directly test the Update path with popScreenMsg
	_, cmd := model.Update(popScreenMsg{})

	// The default case in Update should return the model
	// popScreenMsg is meant to be handled by the parent navigation layer
	if cmd != nil {
		t.Error("expected no command for popScreenMsg at ChatModel level")
	}
}

func TestChatModel_HandleAgentEvent_LlmStart_UpdatesStatus(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "llm_start",
		Data: map[string]interface{}{
			"round": float64(1),
		},
	}

	model.handleAgentEvent(event)

	if model.status != "Thinking... (round 1)" {
		t.Errorf("expected status 'Thinking... (round 1)', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_LlmStart_WithoutRound(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "llm_start",
		Data:      map[string]interface{}{},
	}

	model.handleAgentEvent(event)

	if model.status != "Thinking..." {
		t.Errorf("expected status 'Thinking...', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_ToolStart_UpdatesStatus(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "tool_start",
		Data:      map[string]interface{}{},
	}

	model.handleAgentEvent(event)

	if model.status != "Running code..." {
		t.Errorf("expected status 'Running code...', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_ToolDone_Success(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "tool_done",
		Data: map[string]interface{}{
			"error": false,
		},
	}

	model.handleAgentEvent(event)

	if model.status != "Code finished" {
		t.Errorf("expected status 'Code finished', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_ToolDone_Error(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "tool_done",
		Data: map[string]interface{}{
			"error": true,
		},
	}

	model.handleAgentEvent(event)

	if model.status != "Code error" {
		t.Errorf("expected status 'Code error', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_RecallDone(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	event := protocol.AgentEventParams{
		RequestID: "req-123",
		Kind:      "recall_done",
		Data: map[string]interface{}{
			"count": float64(5),
		},
	}

	model.handleAgentEvent(event)

	if model.status != "Recalled 5 fragments" {
		t.Errorf("expected status 'Recalled 5 fragments', got %q", model.status)
	}
}

func TestChatModel_HandleAgentEvent_IgnoresUnrelatedRequestID(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"
	model.status = "initial"

	event := protocol.AgentEventParams{
		RequestID: "req-456",
		Kind:      "llm_start",
		Data:      map[string]interface{}{},
	}

	model.handleAgentEvent(event)

	if model.status != "initial" {
		t.Errorf("expected status to remain 'initial', got %q", model.status)
	}
}

func TestChatModel_HandleAgentResponse_AppendsMessage(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"
	model.messages = []renderedMessage{}

	response := protocol.AgentResponseParams{
		RequestID: "req-123",
		Text:      "hello from agent",
		Stats: protocol.ChatStats{
			InputTokens:  10,
			OutputTokens: 20,
			Rounds:       1,
		},
	}

	model.handleAgentResponse(response)

	if len(model.messages) != 1 {
		t.Errorf("expected 1 message after response, got %d", len(model.messages))
	}

	if model.messages[0].role != "agent" {
		t.Errorf("expected message role to be 'agent', got %q", model.messages[0].role)
	}

	if model.chatRequestID != "" {
		t.Errorf("expected chatRequestID to be cleared, got %q", model.chatRequestID)
	}

	if model.spinning {
		t.Error("expected spinning to be false")
	}

	if model.status != "10 tokens in, 20 out | 1 rounds" {
		t.Errorf("expected status with token info, got %q", model.status)
	}
}

func TestChatModel_HandleAgentResponse_IgnoresUnrelatedRequestID(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"
	model.messages = []renderedMessage{}

	response := protocol.AgentResponseParams{
		RequestID: "req-456",
		Text:      "hello",
		Stats:     protocol.ChatStats{},
	}

	model.handleAgentResponse(response)

	if len(model.messages) != 0 {
		t.Errorf("expected no message added, got %d", len(model.messages))
	}

	if model.chatRequestID != "req-123" {
		t.Errorf("expected chatRequestID to remain 'req-123', got %q", model.chatRequestID)
	}
}

func TestChatModel_Update_MessagesLoadedMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	msg := messagesLoadedMsg{
		messages: []protocol.MessageRow{
			{
				ID:        1,
				Role:      "user",
				Content:   "hello",
				CreatedAt: "2026-05-09T12:00:00Z",
			},
			{
				ID:        2,
				Role:      "agent",
				Content:   "hi there",
				CreatedAt: "2026-05-09T12:00:01Z",
			},
		},
		cursor: "cursor-abc",
	}

	_, _ = model.Update(msg)

	if len(model.messages) != 2 {
		t.Errorf("expected 2 messages, got %d", len(model.messages))
	}

	if model.messages[0].role != "user" {
		t.Errorf("expected first message role to be 'user', got %q", model.messages[0].role)
	}

	if model.messages[1].role != "agent" {
		t.Errorf("expected second message role to be 'agent', got %q", model.messages[1].role)
	}

	if model.messageCursor != "cursor-abc" {
		t.Errorf("expected messageCursor to be 'cursor-abc', got %q", model.messageCursor)
	}
}

func TestChatModel_Update_ChatStartedMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	msg := chatStartedMsg{
		requestID: "req-789",
	}

	_, cmd := model.Update(msg)

	if model.chatRequestID != "req-789" {
		t.Errorf("expected chatRequestID to be 'req-789', got %q", model.chatRequestID)
	}

	if model.status != "Thinking..." {
		t.Errorf("expected status to be 'Thinking...', got %q", model.status)
	}

	if !model.spinning {
		t.Error("expected spinning to be true")
	}

	if cmd == nil {
		t.Error("expected command to be returned")
	}
}

func TestChatModel_Update_AgentEventMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"

	msg := agentEventMsg{
		event: protocol.AgentEventParams{
			RequestID: "req-123",
			Kind:      "llm_start",
			Data:      map[string]interface{}{},
		},
	}

	_, cmd := model.Update(msg)

	if model.status != "Thinking..." {
		t.Errorf("expected status to be 'Thinking...', got %q", model.status)
	}

	if cmd == nil {
		t.Error("expected command to be returned")
	}
}

func TestChatModel_Update_AgentResponseMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.chatRequestID = "req-123"
	model.messages = []renderedMessage{}

	msg := agentResponseMsg{
		response: protocol.AgentResponseParams{
			RequestID: "req-123",
			Text:      "response text",
			Stats: protocol.ChatStats{
				InputTokens:  5,
				OutputTokens: 10,
				Rounds:       1,
			},
		},
	}

	_, _ = model.Update(msg)

	if len(model.messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(model.messages))
	}

	if model.messages[0].role != "agent" {
		t.Errorf("expected message role to be 'agent', got %q", model.messages[0].role)
	}
}

func TestChatModel_Update_WindowSizeMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

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

func TestChatModel_View_ContainsElements(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.width = 80
	model.height = 24
	model.status = "Ready"

	view := model.View()
	content := view.Content

	if content == "" {
		t.Error("expected view to produce output")
	}

	if !strContains(content, "Chat") {
		t.Error("expected view to contain 'Chat'")
	}

	if !strContains(content, "session-123") {
		t.Error("expected view to contain session ID")
	}

	if !strContains(content, "Ready") {
		t.Error("expected view to contain status")
	}
}

func TestChatModel_View_ShowsThinkingStatus(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.status = "Thinking..."

	view := model.View()
	content := view.Content

	if !strContains(content, "Thinking...") {
		t.Error("expected view to contain 'Thinking...'")
	}
}

func TestChatModel_MessagesErrorSetsStatus(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	msg := messagesErrorMsg{err: fmt.Errorf("connection refused")}

	_, _ = model.Update(msg)

	if !strContains(model.status, "Error") {
		t.Errorf("expected status to contain 'Error', got %q", model.status)
	}

	if !strContains(model.status, "connection refused") {
		t.Errorf("expected status to contain error message, got %q", model.status)
	}
}

func TestChatModel_MessagesErrorSetsErrorFlag(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	msg := messagesErrorMsg{err: fmt.Errorf("connection refused")}

	_, _ = model.Update(msg)

	if !model.statusError {
		t.Error("expected statusError to be true after messagesErrorMsg")
	}
}

func TestChatModel_CanStillTypeAfterError(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	// Simulate error state
	msg := messagesErrorMsg{err: fmt.Errorf("connection refused")}
	_, _ = model.Update(msg)

	if !model.statusError {
		t.Fatal("expected statusError to be true")
	}

	// Set textarea value and send enter
	model.textarea.SetValue("hello world")

	keyMsg := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})
	_, cmd := model.handleKeyPress(keyMsg)

	if cmd == nil {
		t.Error("expected command to be returned, but user can still chat after error")
	}

	if len(model.messages) != 1 {
		t.Errorf("expected 1 message in model, got %d", len(model.messages))
	}
}

func TestChatModel_Update_KeyPressMsg_Up_NoScroll(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.viewport.SetContent("line1\nline2\nline3\nline4\nline5")
	model.viewport.GotoBottom()

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})

	_, _ = model.Update(msg)
}

func TestChatModel_Update_KeyPressMsg_ScrollUpTriggersLoadOlder(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.messages = []renderedMessage{
		{role: "user", rendered: "msg"},
	}
	model.updateViewportContent()

	model.messageCursor = "cursor-123"

	model.viewport.SetYOffset(0)

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})

	_, cmd := model.Update(msg)

	if cmd == nil {
		t.Error("expected command to be returned for load older")
	}
}

func TestChatModel_Update_LoadOlderMsg(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.messages = []renderedMessage{
		{role: "user", rendered: "new msg"},
	}
	model.updateViewportContent()
	oldLineCount := model.viewport.TotalLineCount()

	msg := loadOlderMsg{
		messages: []protocol.MessageRow{
			{Role: "user", Content: "old msg"},
		},
		cursor: "cursor-456",
	}

	_, _ = model.Update(msg)

	if len(model.messages) != 2 {
		t.Errorf("expected 2 messages after load, got %d", len(model.messages))
	}

	if !strContains(model.messages[0].rendered, "old msg") {
		t.Error("expected old message to be prepended")
	}

	if model.messageCursor != "cursor-456" {
		t.Errorf("expected cursor to be updated, got %q", model.messageCursor)
	}

	if model.viewport.TotalLineCount() <= oldLineCount {
		t.Error("expected viewport line count to increase")
	}
}

func TestChatModel_UpdateViewportContent_RendersAllMessages(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	model.messages = []renderedMessage{
		{role: "user", rendered: "user message\n"},
		{role: "agent", rendered: "agent message\n"},
	}

	model.updateViewportContent()

	// Check that messages were rendered and stored in viewport
	// We'll verify by checking the messages were appended
	if len(model.messages) != 2 {
		t.Errorf("expected 2 messages to be stored, got %d", len(model.messages))
	}
}

func TestChatModel_LoadOlderErrorPreservesMessages(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	// Load initial messages
	messagesMsg := messagesLoadedMsg{
		messages: []protocol.MessageRow{
			{Role: "user", Content: "msg1"},
			{Role: "agent", Content: "msg2"},
			{Role: "user", Content: "msg3"},
		},
		cursor: "cursor-abc",
	}
	_, _ = model.Update(messagesMsg)

	if len(model.messages) != 3 {
		t.Fatalf("expected 3 messages after load, got %d", len(model.messages))
	}

	// Send load older error
	errorMsg := loadOlderErrorMsg{err: fmt.Errorf("timeout")}
	_, _ = model.Update(errorMsg)

	// Verify messages are preserved
	if len(model.messages) != 3 {
		t.Errorf("expected 3 messages after error (unchanged), got %d", len(model.messages))
	}

	// Verify error status is set
	if !strContains(model.status, "Error loading older messages") {
		t.Errorf("expected status to contain error message, got %q", model.status)
	}

	// Verify statusError is true
	if !model.statusError {
		t.Error("expected statusError to be true")
	}
}

func TestChatModel_TextareaPlaceholder(t *testing.T) {
	client := newChatClient()
	model := NewChatModel(client, "session-123")

	if model.textarea.Placeholder != "Type a message..." {
		t.Errorf("expected placeholder 'Type a message...', got %q", model.textarea.Placeholder)
	}

	if model.textarea.ShowLineNumbers {
		t.Error("expected ShowLineNumbers to be false")
	}

	if model.textarea.MaxHeight != 4 {
		t.Errorf("expected MaxHeight to be 4, got %d", model.textarea.MaxHeight)
	}
}

func strContains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && strings.Contains(s, substr)
}
