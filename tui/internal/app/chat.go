// pattern: Imperative Shell
package app

import (
	"constellation-tui/internal/layout"
	"constellation-tui/internal/protocol"
	"constellation-tui/internal/render"
	"context"
	"fmt"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
)

type ChatModel struct {
	client    *protocol.Client
	sessionID string
	renderer  *render.Renderer

	viewport viewport.Model
	textarea textarea.Model
	status   string
	spinning bool
	statusError bool

	messages      []renderedMessage
	chatRequestID string

	eventCh    chan protocol.AgentEventParams
	responseCh chan protocol.AgentResponseParams

	messageCursor string

	width  int
	height int
}

type renderedMessage struct {
	role     string
	rendered string
}

type messagesLoadedMsg struct {
	messages []protocol.MessageRow
	cursor   string
}

type messagesErrorMsg struct {
	err error
}

type chatStartedMsg struct {
	requestID string
}

type agentEventMsg struct {
	event protocol.AgentEventParams
}

type agentResponseMsg struct {
	response protocol.AgentResponseParams
}

type loadOlderMsg struct {
	messages []protocol.MessageRow
	cursor   string
}

type loadOlderErrorMsg struct {
	err error
}

type popScreenMsg struct{}

func NewChatModel(client *protocol.Client, sessionID string) *ChatModel {
	m := &ChatModel{
		client:     client,
		sessionID:  sessionID,
		viewport:   viewport.New(),
		textarea:   textarea.New(),
		eventCh:    make(chan protocol.AgentEventParams, 10),
		responseCh: make(chan protocol.AgentResponseParams, 10),
		width:      80,
		height:     24,
	}

	m.textarea.Placeholder = "Type a message..."
	m.textarea.ShowLineNumbers = false
	m.textarea.MaxHeight = 4
	m.textarea.Focus()

	if err := m.createRenderer(); err != nil {
		m.status = fmt.Sprintf("Error: %v", err)
	}

	m.client.SetOnAgentEvent(func(ev protocol.AgentEventParams) {
		select {
		case m.eventCh <- ev:
		default:
			fmt.Fprintf(os.Stderr, "warning: dropped agent event (channel full)\n")
		}
	})

	m.client.SetOnAgentResponse(func(resp protocol.AgentResponseParams) {
		select {
		case m.responseCh <- resp:
		default:
			fmt.Fprintf(os.Stderr, "warning: dropped agent response (channel full)\n")
		}
	})

	return m
}

func (m *ChatModel) createRenderer() error {
	var err error
	m.renderer, err = render.NewRenderer(m.width)
	return err
}

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

func (m *ChatModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

		if err := m.renderer.SetWidth(m.width); err != nil {
			m.status = fmt.Sprintf("Renderer error: %v", err)
		}

		chatLayout := layout.ComputeChatLayout(m.width, m.height, m.textarea.LineCount())
		m.viewport.SetWidth(chatLayout.Width)
		m.viewport.SetHeight(chatLayout.ViewportHeight)
		m.textarea.SetWidth(chatLayout.Width)
		m.textarea.SetHeight(chatLayout.InputHeight)

	case messagesLoadedMsg:
		m.messages = make([]renderedMessage, 0, len(msg.messages))
		for _, row := range msg.messages {
			rendered := ""
			if row.Role == "user" {
				rendered = m.renderer.RenderUserMessage(row.Content)
			} else {
				rendered = m.renderer.RenderAgentMessage(row.Content)
			}
			m.messages = append(m.messages, renderedMessage{role: row.Role, rendered: rendered})
		}
		m.messageCursor = msg.cursor
		m.updateViewportContent()
		m.statusError = false

	case messagesErrorMsg:
		m.status = fmt.Sprintf("Error: %v", msg.err)
		m.statusError = true
		m.spinning = false

	case loadOlderMsg:
		oldLineCount := m.viewport.TotalLineCount()
		oldYOffset := m.viewport.YOffset()

		olderMessages := make([]renderedMessage, 0, len(msg.messages))
		for _, row := range msg.messages {
			rendered := ""
			if row.Role == "user" {
				rendered = m.renderer.RenderUserMessage(row.Content)
			} else {
				rendered = m.renderer.RenderAgentMessage(row.Content)
			}
			olderMessages = append(olderMessages, renderedMessage{role: row.Role, rendered: rendered})
		}
		m.messages = append(olderMessages, m.messages...)
		m.messageCursor = msg.cursor
		m.updateViewportContent()
		m.statusError = false

		newLineCount := m.viewport.TotalLineCount()
		linesAdded := newLineCount - oldLineCount
		if linesAdded > 0 {
			m.viewport.SetYOffset(oldYOffset + linesAdded)
		}

	case loadOlderErrorMsg:
		m.status = fmt.Sprintf("Error loading older messages: %v", msg.err)
		m.statusError = true

	case chatStartedMsg:
		m.chatRequestID = msg.requestID
		m.status = "Thinking..."
		m.spinning = true
		m.statusError = false
		return m, m.waitForEvent()

	case agentEventMsg:
		m.statusError = false
		m.handleAgentEvent(msg.event)
		return m, m.waitForEvent()

	case agentResponseMsg:
		m.statusError = false
		m.handleAgentResponse(msg.response)

	case tea.KeyPressMsg:
		return m.handleKeyPress(msg)

	default:
		m.viewport, cmd = m.viewport.Update(msg)
		m.textarea, _ = m.textarea.Update(msg)
		return m, cmd
	}

	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m *ChatModel) handleKeyPress(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		if m.chatRequestID != "" {
			m.textarea, _ = m.textarea.Update(msg)
			return m, nil
		}

		text := strings.TrimSpace(m.textarea.Value())
		if text == "" {
			return m, nil
		}

		if strings.HasPrefix(text, "/") {
			cmd := strings.TrimPrefix(text, "/")
			m.textarea.SetValue("")
			return m, func() tea.Msg {
				return SlashCommandMsg{Command: cmd}
			}
		}

		rendered := m.renderer.RenderUserMessage(text)
		m.messages = append(m.messages, renderedMessage{role: "user", rendered: rendered})
		m.textarea.SetValue("")
		m.updateViewportContent()

		return m, func() tea.Msg {
			result, err := m.client.Chat(context.Background(), text, m.sessionID)
			if err != nil {
				return agentResponseMsg{response: protocol.AgentResponseParams{
					RequestID: "",
					Text:      fmt.Sprintf("Error: %v", err),
				}}
			}
			return chatStartedMsg{requestID: result.RequestID}
		}

	case "esc":
		return m, func() tea.Msg {
			return popScreenMsg{}
		}

	case "up", "pgup":
		if m.viewport.YOffset() == 0 && m.messageCursor != "" {
			return m, m.loadOlderMessages()
		}
		m.viewport, _ = m.viewport.Update(msg)
		return m, nil

	case "down", "pgdown":
		m.viewport, _ = m.viewport.Update(msg)
		return m, nil

	default:
		m.textarea, _ = m.textarea.Update(msg)
		return m, nil
	}
}

func (m *ChatModel) handleAgentEvent(event protocol.AgentEventParams) {
	if event.RequestID != m.chatRequestID {
		return
	}

	switch event.Kind {
	case "llm_start":
		if round, ok := event.Data["round"].(float64); ok {
			m.status = fmt.Sprintf("Thinking... (round %.0f)", round)
		} else {
			m.status = "Thinking..."
		}
	case "llm_done":
		if round, ok := event.Data["round"].(float64); ok {
			m.status = fmt.Sprintf("Round %.0f complete", round)
		} else {
			m.status = "Round complete"
		}
	case "tool_start":
		m.status = "Running code..."
	case "tool_done":
		if err, ok := event.Data["error"].(bool); ok && err {
			m.status = "Code error"
		} else {
			m.status = "Code finished"
		}
	case "recall_done":
		if count, ok := event.Data["count"].(float64); ok {
			m.status = fmt.Sprintf("Recalled %.0f fragments", count)
		} else {
			m.status = "Recall done"
		}
	}
}

func (m *ChatModel) handleAgentResponse(resp protocol.AgentResponseParams) {
	if resp.RequestID != m.chatRequestID {
		return
	}

	rendered := m.renderer.RenderAgentMessage(resp.Text)
	m.messages = append(m.messages, renderedMessage{role: "agent", rendered: rendered})
	m.updateViewportContent()

	m.chatRequestID = ""
	m.spinning = false
	m.status = fmt.Sprintf("%d tokens in, %d out | %d rounds", resp.Stats.InputTokens, resp.Stats.OutputTokens, resp.Stats.Rounds)
}

func (m *ChatModel) waitForEvent() tea.Cmd {
	return func() tea.Msg {
		select {
		case ev := <-m.eventCh:
			return agentEventMsg{event: ev}
		case resp := <-m.responseCh:
			return agentResponseMsg{response: resp}
		}
	}
}

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

func (m *ChatModel) updateViewportContent() {
	var sb strings.Builder
	for _, msg := range m.messages {
		sb.WriteString(msg.rendered)
	}
	m.viewport.SetContent(sb.String())
	m.viewport.GotoBottom()
}

func (m *ChatModel) View() tea.View {
	chatLayout := layout.ComputeChatLayout(m.width, m.height, m.textarea.LineCount())

	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("Chat • Session: %s", m.sessionID))

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

	var view strings.Builder
	view.WriteString(lipgloss.NewStyle().Height(chatLayout.HeaderHeight).Render(header))
	view.WriteString("\n")
	view.WriteString(lipgloss.NewStyle().Height(chatLayout.ViewportHeight).Render(m.viewport.View()))
	view.WriteString("\n")
	view.WriteString(statusPane)
	view.WriteString("\n")
	view.WriteString(m.textarea.View())

	return tea.NewView(view.String())
}
