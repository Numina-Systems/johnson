package app

import (
	"constellation-tui/internal/protocol"
	tea "charm.land/bubbletea/v2"
)

type ScreenType int

const (
	ScreenSessions ScreenType = iota
	ScreenChat
	ScreenTools
	ScreenSecrets
	ScreenSchedules
	ScreenPrompt
)

type AppModel struct {
	client       *protocol.Client
	activeScreen ScreenType
	screenStack  []ScreenType
	sessions     *SessionsModel
	chat         *ChatModel
	width        int
	height       int
}

func NewAppModel(client *protocol.Client) *AppModel {
	return &AppModel{
		client:      client,
		activeScreen: ScreenSessions,
		screenStack: []ScreenType{ScreenSessions},
		sessions:    NewSessionsModel(client),
	}
}

func (m *AppModel) Init() tea.Cmd {
	return m.sessions.Init()
}

func (m *AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case NavigateToChatMsg:
		// Create new chat model with selected session
		m.chat = NewChatModel(m.client, msg.SessionID)
		m.pushScreen(ScreenChat)
		return m, m.chat.Init()

	case backToSessionsMsg:
		// Return to sessions screen
		m.popScreen()
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.sessions.width = msg.Width
		m.sessions.height = msg.Height
		if m.chat != nil {
			m.chat.width = msg.Width
			m.chat.height = msg.Height
		}
		sessionsModel, cmd := m.sessions.Update(msg)
		m.sessions = sessionsModel.(*SessionsModel)

		var cmds []tea.Cmd
		cmds = append(cmds, cmd)
		if m.activeScreen == ScreenChat && m.chat != nil {
			_, chatCmd := m.chat.Update(msg)
			cmds = append(cmds, chatCmd)
		}
		return m, tea.Batch(cmds...)

	case tea.KeyPressMsg:
		switch msg.String() {
		case "ctrl+t":
			m.pushScreen(ScreenTools)
			return m, nil
		case "ctrl+s":
			m.pushScreen(ScreenSecrets)
			return m, nil
		case "ctrl+d":
			m.pushScreen(ScreenSchedules)
			return m, nil
		case "ctrl+p":
			m.pushScreen(ScreenPrompt)
			return m, nil
		case "esc":
			m.popScreen()
			return m, nil
		case "ctrl+c":
			return m, tea.Quit
		}
	}

	// Delegate to active screen
	var cmds []tea.Cmd
	switch m.activeScreen {
	case ScreenSessions:
		sessionsModel, cmd := m.sessions.Update(msg)
		m.sessions = sessionsModel.(*SessionsModel)
		cmds = append(cmds, cmd)
	case ScreenChat:
		if m.chat != nil {
			_, cmd := m.chat.Update(msg)
			cmds = append(cmds, cmd)
		}
	}

	if len(cmds) > 0 {
		return m, tea.Batch(cmds...)
	}
	return m, nil
}

func (m *AppModel) View() tea.View {
	switch m.activeScreen {
	case ScreenSessions:
		return m.sessions.View()
	case ScreenChat:
		if m.chat != nil {
			return m.chat.View()
		}
		return tea.NewView("Chat screen initializing...")
	case ScreenTools:
		return tea.NewView("Tools screen (not yet implemented)")
	case ScreenSecrets:
		return tea.NewView("Secrets screen (not yet implemented)")
	case ScreenSchedules:
		return tea.NewView("Schedules screen (not yet implemented)")
	case ScreenPrompt:
		return tea.NewView("System Prompt screen (not yet implemented)")
	default:
		return tea.NewView("Unknown screen")
	}
}

func (m *AppModel) pushScreen(s ScreenType) {
	m.screenStack = append(m.screenStack, s)
	m.activeScreen = s
}

func (m *AppModel) popScreen() {
	if len(m.screenStack) > 1 {
		m.screenStack = m.screenStack[:len(m.screenStack)-1]
		m.activeScreen = m.screenStack[len(m.screenStack)-1]
	}
}
