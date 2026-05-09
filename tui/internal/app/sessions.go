package app

import (
	"constellation-tui/internal/protocol"
	"fmt"
	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/list"
)

// SessionsModel represents the sessions screen
type SessionsModel struct {
	list      list.Model
	client    *protocol.Client
	width     int
	height    int
	errorMsg  string
}

// NewSessionsModel creates a new sessions screen model
func NewSessionsModel(client *protocol.Client) *SessionsModel {
	// Initial dimensions are defaults (80x24), overridden by WindowSizeMsg on first render
	return &SessionsModel{
		list:   list.New([]list.Item{}, list.NewDefaultDelegate(), 80, 24),
		client: client,
		width:  80,
		height: 24,
	}
}

func (m *SessionsModel) Init() tea.Cmd {
	return loadSessionsCmd(m.client)
}

func (m *SessionsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.list.SetSize(msg.Width, msg.Height)
	case sessionsLoadedMsg:
		m.errorMsg = ""
		items := make([]list.Item, len(msg.sessions))
		for i, s := range msg.sessions {
			items[i] = newSessionItem(s)
		}
		m.list.SetItems(items)
	case sessionCreatedMsg:
		m.errorMsg = ""
		return m, loadSessionsCmd(m.client)
	case sessionDeletedMsg:
		m.errorMsg = ""
		return m, loadSessionsCmd(m.client)
	case sessionsErrorMsg:
		m.errorMsg = msg.err.Error()
		return m, nil
	case tea.KeyPressMsg:
		switch msg.String() {
		case "enter":
			if selected, ok := m.list.SelectedItem().(sessionItem); ok {
				// TODO: Navigate to chat with selected session
				_ = selected
			}
		case "n":
			return m, createSessionCmd(m.client)
		case "d":
			if selected, ok := m.list.SelectedItem().(sessionItem); ok {
				return m, deleteSessionCmd(m.client, selected.id)
			}
		}
	}

	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

func (m *SessionsModel) View() tea.View {
	var view string
	if m.errorMsg != "" {
		view = fmt.Sprintf("Error: %s\n\n%s", m.errorMsg, m.list.View())
	} else {
		view = m.list.View()
	}
	return tea.NewView(view)
}

// sessionItem represents a session in the list
type sessionItem struct {
	id           string
	title        *string
	updatedAt    string
	messageCount int
}

func newSessionItem(row protocol.SessionRow) sessionItem {
	return sessionItem{
		id:           row.ID,
		title:        row.Title,
		updatedAt:    row.UpdatedAt,
		messageCount: row.MessageCount,
	}
}

func (s sessionItem) FilterValue() string {
	if s.title != nil {
		return *s.title
	}
	return "Untitled session"
}

func (s sessionItem) Title() string {
	if s.title != nil {
		return *s.title
	}
	return "Untitled session"
}

func (s sessionItem) Description() string {
	return fmt.Sprintf("%d messages · %s", s.messageCount, s.updatedAt)
}

// Custom message types for async results
type sessionsLoadedMsg struct {
	sessions []protocol.SessionRow
}

type sessionCreatedMsg struct {
	id string
}

type sessionDeletedMsg struct{}

type sessionsErrorMsg struct {
	err error
}

// Command functions
func loadSessionsCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionListResult
		err := client.Call(nil, "session/list", nil, &result)
		if err != nil {
			return sessionsErrorMsg{err}
		}
		return sessionsLoadedMsg{sessions: result.Sessions}
	}
}

func createSessionCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionCreateResult
		err := client.Call(nil, "session/create", protocol.SessionCreateParams{}, &result)
		if err != nil {
			return sessionsErrorMsg{err}
		}
		return sessionCreatedMsg{id: result.ID}
	}
}

func deleteSessionCmd(client *protocol.Client, id string) tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionDeleteResult
		err := client.Call(nil, "session/delete", protocol.SessionDeleteParams{ID: id}, &result)
		if err != nil {
			return sessionsErrorMsg{err}
		}
		return sessionDeletedMsg{}
	}
}
