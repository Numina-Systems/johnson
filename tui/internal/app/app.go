// pattern: Imperative Shell
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

type SlashCommandMsg struct {
	Command string
}

type backendCrashedMsg struct {
	err error
}

type backendRestartedMsg struct {
	client *protocol.Client
}

type newSessionCreatedMsg struct {
	sessionID string
}

type newSessionErrorMsg struct {
	err error
}

func NewAppModel(client *protocol.Client, backend *backend.BackendProcess, initialSessionID string) *AppModel {
	m := &AppModel{
		client:  client,
		backend: backend,
	}

	if initialSessionID != "" {
		m.activeScreen = ScreenChat
		m.screenStack = []ScreenType{ScreenChat}
		m.chat = NewChatModel(client, initialSessionID)
	} else {
		m.activeScreen = ScreenSessions
		m.screenStack = []ScreenType{ScreenSessions}
		m.sessions = NewSessionsModel(client)
	}

	return m
}

func (m *AppModel) Init() tea.Cmd {
	cmds := []tea.Cmd{watchBackend(m.backend)}
	if m.chat != nil {
		cmds = append(cmds, m.chat.Init())
	}
	if m.sessions != nil {
		cmds = append(cmds, m.sessions.Init())
	}
	return tea.Batch(cmds...)
}

func watchBackend(proc *backend.BackendProcess) tea.Cmd {
	return func() tea.Msg {
		<-proc.Done()
		err := <-proc.WaitExit()
		return backendCrashedMsg{err: err}
	}
}

func restartBackend(m *AppModel) tea.Cmd {
	return func() tea.Msg {
		// Use context.Background() to ensure restart completes even during shutdown
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

func (m *AppModel) createNewSession() tea.Cmd {
	return func() tea.Msg {
		var result protocol.SessionCreateResult
		err := m.client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &result)
		if err != nil {
			return newSessionErrorMsg{err: err}
		}
		return newSessionCreatedMsg{sessionID: result.ID}
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
		m.chat = nil
		m.tools = nil
		m.secrets = nil
		m.schedules = nil
		m.prompt = nil

		// Try to create a new session (same as startup)
		var createResult protocol.SessionCreateResult
		err := m.client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &createResult)
		if err != nil {
			m.activeScreen = ScreenSessions
			m.screenStack = []ScreenType{ScreenSessions}
			m.sessions = NewSessionsModel(m.client)
			return m, tea.Batch(
				m.sessions.Init(),
				watchBackend(m.backend),
			)
		}
		m.activeScreen = ScreenChat
		m.screenStack = []ScreenType{ScreenChat}
		m.chat = NewChatModel(m.client, createResult.ID)
		return m, tea.Batch(
			m.chat.Init(),
			watchBackend(m.backend),
		)

	case SlashCommandMsg:
		switch msg.Command {
		case "sessions":
			if m.sessions == nil {
				m.sessions = NewSessionsModel(m.client)
			}
			m.pushScreen(ScreenSessions)
			return m, m.sessions.Init()
		case "tools":
			m.tools = NewToolsModel(m.client)
			m.pushScreen(ScreenTools)
			return m, m.tools.Init()
		case "secrets":
			m.secrets = NewSecretsModel(m.client)
			m.pushScreen(ScreenSecrets)
			return m, m.secrets.Init()
		case "schedules":
			m.schedules = NewSchedulesModel(m.client)
			m.pushScreen(ScreenSchedules)
			return m, m.schedules.Init()
		case "prompt":
			m.prompt = NewPromptModel(m.client)
			m.pushScreen(ScreenPrompt)
			return m, m.prompt.Init()
		case "new":
			return m, m.createNewSession()
		case "back":
			m.popScreen()
			return m, nil
		case "quit":
			return m, tea.Quit
		}
		return m, nil

	case NavigateToChatMsg:
		m.chat = NewChatModel(m.client, msg.SessionID)
		// Reset stack to chat — session selection always returns to a clean chat root
		m.screenStack = []ScreenType{ScreenChat}
		m.activeScreen = ScreenChat
		return m, m.chat.Init()

	case popScreenMsg:
		m.popScreen()
		return m, nil

	case newSessionCreatedMsg:
		m.chat = NewChatModel(m.client, msg.sessionID)
		if m.activeScreen == ScreenChat {
			return m, m.chat.Init()
		}
		m.pushScreen(ScreenChat)
		return m, m.chat.Init()

	case newSessionErrorMsg:
		if m.chat != nil {
			m.chat.status = fmt.Sprintf("Error: failed to create session: %v", msg.err)
		}
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		if m.sessions != nil {
			m.sessions.width = msg.Width
			m.sessions.height = msg.Height
		}
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
		var cmds []tea.Cmd
		if m.sessions != nil {
			sessionsModel, cmd := m.sessions.Update(msg)
			m.sessions = sessionsModel.(*SessionsModel)
			cmds = append(cmds, cmd)
		}
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

		switch msg.String() {
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
