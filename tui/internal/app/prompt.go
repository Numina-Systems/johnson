// pattern: Imperative Shell
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
)

type PromptModel struct {
	client   *protocol.Client
	viewport viewport.Model
	ready    bool
	width    int
	height   int
	errorMsg string
}

func NewPromptModel(client *protocol.Client) *PromptModel {
	return &PromptModel{
		client:   client,
		viewport: viewport.New(),
		ready:    false,
		width:    80,
		height:   24,
	}
}

func (m *PromptModel) Init() tea.Cmd {
	return loadPromptCmd(m.client)
}

func (m *PromptModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.viewport.SetWidth(msg.Width)
		m.viewport.SetHeight(msg.Height - 4)

	case promptLoadedMsg:
		m.errorMsg = ""
		m.viewport.SetContent(msg.prompt)
		m.ready = true
		return m, nil

	case promptErrorMsg:
		m.errorMsg = msg.err.Error()
		return m, nil

	case tea.KeyPressMsg:
		switch msg.String() {
		case "esc":
			return m, func() tea.Msg { return popScreenMsg{} }

		case "j", "down":
			m.viewport.ScrollDown(1)
			return m, nil

		case "k", "up":
			m.viewport.ScrollUp(1)
			return m, nil

		case "g":
			m.viewport.GotoTop()
			return m, nil

		case "G":
			m.viewport.GotoBottom()
			return m, nil

		case "pagedown":
			m.viewport.PageDown()
			return m, nil

		case "pageup":
			m.viewport.PageUp()
			return m, nil

		default:
			var cmd tea.Cmd
			m.viewport, cmd = m.viewport.Update(msg)
			return m, cmd
		}
	}

	return m, nil
}

func (m *PromptModel) View() tea.View {
	var view string

	if m.errorMsg != "" {
		view = lipgloss.NewStyle().
			Foreground(lipgloss.Color("1")).
			Render("Error: " + m.errorMsg + "\n\n")
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("Escape: back")
		return tea.NewView(view)
	}

	if !m.ready {
		view = "Loading system prompt...\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("Escape: back")
		return tea.NewView(view)
	}

	view = "System Prompt\n"
	view += lipgloss.NewStyle().
		Foreground(lipgloss.Color("8")).
		Render("────────────────\n")
	view += m.viewport.View() + "\n"
	view += lipgloss.NewStyle().
		Foreground(lipgloss.Color("8")).
		Render("j/k: scroll  g/G: top/bottom  Escape: back")

	return tea.NewView(view)
}

// Message types

type promptLoadedMsg struct {
	prompt string
}

type promptErrorMsg struct {
	err error
}

// Commands

func loadPromptCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.GetPrompt(ctx)
		if err != nil {
			return promptErrorMsg{err}
		}
		return promptLoadedMsg{prompt: result.Prompt}
	}
}
