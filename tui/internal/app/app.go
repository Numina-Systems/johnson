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
	tools        *ToolsModel
	secrets      *SecretsModel
	schedules    *SchedulesModel
	prompt       *PromptModel
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
		if m.tools != nil {
			m.tools.width = msg.Width
			m.tools.height = msg.Height
		}
		if m.secrets != nil {
			m.secrets.width = msg.Width
			m.secrets.height = msg.Height
		}
		if m.schedules != nil {
			m.schedules.width = msg.Width
			m.schedules.height = msg.Height
		}
		if m.prompt != nil {
			m.prompt.width = msg.Width
			m.prompt.height = msg.Height
		}
		sessionsModel, cmd := m.sessions.Update(msg)
		m.sessions = sessionsModel.(*SessionsModel)

		var cmds []tea.Cmd
		cmds = append(cmds, cmd)
		if m.activeScreen == ScreenChat && m.chat != nil {
			_, chatCmd := m.chat.Update(msg)
			cmds = append(cmds, chatCmd)
		}
		if m.activeScreen == ScreenTools && m.tools != nil {
			_, toolsCmd := m.tools.Update(msg)
			cmds = append(cmds, toolsCmd)
		}
		if m.activeScreen == ScreenSecrets && m.secrets != nil {
			_, secretsCmd := m.secrets.Update(msg)
			cmds = append(cmds, secretsCmd)
		}
		if m.activeScreen == ScreenSchedules && m.schedules != nil {
			_, schedulesCmd := m.schedules.Update(msg)
			cmds = append(cmds, schedulesCmd)
		}
		if m.activeScreen == ScreenPrompt && m.prompt != nil {
			_, promptCmd := m.prompt.Update(msg)
			cmds = append(cmds, promptCmd)
		}
		return m, tea.Batch(cmds...)

	case tea.KeyPressMsg:
		switch msg.String() {
		case "ctrl+t":
			m.tools = NewToolsModel(m.client)
			m.pushScreen(ScreenTools)
			return m, m.tools.Init()
		case "ctrl+s":
			m.secrets = NewSecretsModel(m.client)
			m.pushScreen(ScreenSecrets)
			return m, m.secrets.Init()
		case "ctrl+d":
			m.schedules = NewSchedulesModel(m.client)
			m.pushScreen(ScreenSchedules)
			return m, m.schedules.Init()
		case "ctrl+p":
			m.prompt = NewPromptModel(m.client)
			m.pushScreen(ScreenPrompt)
			return m, m.prompt.Init()
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
	case ScreenTools:
		if m.tools != nil {
			_, cmd := m.tools.Update(msg)
			cmds = append(cmds, cmd)
		}
	case ScreenSecrets:
		if m.secrets != nil {
			_, cmd := m.secrets.Update(msg)
			cmds = append(cmds, cmd)
		}
	case ScreenSchedules:
		if m.schedules != nil {
			_, cmd := m.schedules.Update(msg)
			cmds = append(cmds, cmd)
		}
	case ScreenPrompt:
		if m.prompt != nil {
			_, cmd := m.prompt.Update(msg)
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
		if m.tools != nil {
			return m.tools.View()
		}
		return tea.NewView("Tools screen initializing...")
	case ScreenSecrets:
		if m.secrets != nil {
			return m.secrets.View()
		}
		return tea.NewView("Secrets screen initializing...")
	case ScreenSchedules:
		if m.schedules != nil {
			return m.schedules.View()
		}
		return tea.NewView("Schedules screen initializing...")
	case ScreenPrompt:
		if m.prompt != nil {
			return m.prompt.View()
		}
		return tea.NewView("Prompt screen initializing...")
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
