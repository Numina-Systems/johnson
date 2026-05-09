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
	client      *protocol.Client
	activeScreen ScreenType
	screenStack []ScreenType
	sessions    *SessionsModel
	width       int
	height      int
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
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.sessions.width = msg.Width
		m.sessions.height = msg.Height
		sessionsModel, cmd := m.sessions.Update(msg)
		m.sessions = sessionsModel.(*SessionsModel)
		return m, cmd

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
	}

	if len(cmds) > 0 {
		return m, tea.Batch(cmds...)
	}
	return m, nil
}

func (m *AppModel) View() tea.View {
	var content string

	switch m.activeScreen {
	case ScreenSessions:
		return m.sessions.View()
	case ScreenChat:
		content = "Chat screen (not yet implemented)"
	case ScreenTools:
		content = "Tools screen (not yet implemented)"
	case ScreenSecrets:
		content = "Secrets screen (not yet implemented)"
	case ScreenSchedules:
		content = "Schedules screen (not yet implemented)"
	case ScreenPrompt:
		content = "System Prompt screen (not yet implemented)"
	default:
		content = "Unknown screen"
	}

	return tea.NewView(content)
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
