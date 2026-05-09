package app

import (
	"constellation-tui/internal/backend"
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
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
	backend      *backend.BackendProcess
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
	crashed      bool
	crashErr     string
}

type backendCrashedMsg struct {
	err error
}

type backendRestartedMsg struct {
	client *protocol.Client
}

func NewAppModel(client *protocol.Client, backend *backend.BackendProcess) *AppModel {
	return &AppModel{
		client:       client,
		backend:      backend,
		activeScreen: ScreenSessions,
		screenStack:  []ScreenType{ScreenSessions},
		sessions:     NewSessionsModel(client),
	}
}

func (m *AppModel) Init() tea.Cmd {
	return tea.Batch(
		m.sessions.Init(),
		watchBackend(m.backend),
	)
}

func watchBackend(proc *backend.BackendProcess) tea.Cmd {
	return func() tea.Msg {
		err := <-proc.WaitExit()
		return backendCrashedMsg{err: err}
	}
}

func restartBackend(m *AppModel) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()

		// Restart the process
		stdout, stdin, err := m.backend.Restart(ctx)
		if err != nil {
			return backendCrashedMsg{err: fmt.Errorf("failed to restart backend: %w", err)}
		}

		// Create new protocol client
		newClient, err := protocol.NewClient(ctx, stdout, stdin)
		if err != nil {
			return backendCrashedMsg{err: fmt.Errorf("failed to create protocol client: %w", err)}
		}

		// Wait for ready notification
		ready, err := newClient.WaitReady(ctx)
		if err != nil {
			return backendCrashedMsg{err: fmt.Errorf("failed to receive ready notification: %w", err)}
		}

		// Protocol version check
		if ready.ProtocolVersion != "1" {
			return backendCrashedMsg{err: fmt.Errorf("unsupported protocol version: %s (expected 1)", ready.ProtocolVersion)}
		}

		return backendRestartedMsg{
			client: newClient,
		}
	}
}

func (m *AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case backendCrashedMsg:
		if msg.err == nil {
			// Clean exit, not a crash
			return m, tea.Quit
		}
		// Backend crashed unexpectedly
		m.crashed = true
		m.crashErr = msg.err.Error()
		return m, nil

	case backendRestartedMsg:
		// Backend restarted successfully
		m.client = msg.client
		m.crashed = false
		m.crashErr = ""
		m.activeScreen = ScreenSessions
		m.screenStack = []ScreenType{ScreenSessions}
		m.sessions = NewSessionsModel(m.client)
		m.chat = nil
		m.tools = nil
		m.secrets = nil
		m.schedules = nil
		m.prompt = nil
		// Resume watching backend
		return m, tea.Batch(
			m.sessions.Init(),
			watchBackend(m.backend),
		)

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
		// Handle crash recovery UI
		if m.crashed {
			switch msg.String() {
			case "r":
				return m, restartBackend(m)
			case "q":
				return m, tea.Quit
			}
			return m, nil
		}

		// Normal keybindings
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
	if m.crashed {
		return tea.NewView(fmt.Sprintf(
			"Backend process exited unexpectedly.\n\nError: %s\n\nPress 'r' to restart, or 'q' to quit.",
			m.crashErr,
		))
	}

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
