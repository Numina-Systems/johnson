// pattern: Imperative Shell
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	"strings"
	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/textinput"
	"charm.land/lipgloss/v2"
)

type secretsMode int

const (
	secretsModeList secretsMode = iota
	secretsModeAddName
	secretsModeAddValue
	secretsModeAssign
)

type assignableEntry struct {
	name       string
	isCustom   bool
	hasSecret  bool
	allSecrets []string
}

type SecretsModel struct {
	client       *protocol.Client
	keys         []string
	cursor       int
	mode         secretsMode
	nameInput    textinput.Model
	valueInput   textinput.Model
	width        int
	height       int
	errorMsg     string
	statusMsg    string
	assignSecret string
	assignables  []assignableEntry
	assignCursor int
}

func NewSecretsModel(client *protocol.Client) *SecretsModel {
	nameInput := textinput.New()
	nameInput.Placeholder = "secret name"
	nameInput.CharLimit = 256
	nameInput.Focus()

	valueInput := textinput.New()
	valueInput.Placeholder = "secret value"
	valueInput.CharLimit = 4096
	valueInput.EchoMode = textinput.EchoPassword

	return &SecretsModel{
		client:     client,
		keys:       []string{},
		cursor:     0,
		mode:       secretsModeList,
		nameInput:  nameInput,
		valueInput: valueInput,
		width:      80,
		height:     24,
	}
}

func (m *SecretsModel) Init() tea.Cmd {
	return loadSecretsCmd(m.client)
}

func (m *SecretsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case secretsLoadedMsg:
		m.errorMsg = ""
		m.keys = msg.keys
		if m.cursor >= len(m.keys) {
			m.cursor = 0
		}
		return m, nil

	case secretsErrorMsg:
		m.errorMsg = msg.err.Error()
		return m, nil

	case secretsAssignablesLoadedMsg:
		m.assignables = msg.entries
		m.assignCursor = 0
		m.mode = secretsModeAssign
		return m, nil

	case secretsAssignSavedMsg:
		m.mode = secretsModeList
		m.statusMsg = fmt.Sprintf("Updated assignments for %s", msg.secret)
		return m, loadSecretsCmd(m.client)

	case tea.KeyPressMsg:
		switch m.mode {
		case secretsModeList:
			switch msg.String() {
			case "esc":
				return m, func() tea.Msg { return popScreenMsg{} }

			case "j", "down":
				if m.cursor < len(m.keys)-1 {
					m.cursor++
				}
				return m, nil

			case "k", "up":
				if m.cursor > 0 {
					m.cursor--
				}
				return m, nil

			case "a", "n":
				m.mode = secretsModeAddName
				m.nameInput.Reset()
				m.nameInput.Focus()
				return m, textinput.Blink

			case "d":
				if m.cursor < len(m.keys) {
					selectedKey := m.keys[m.cursor]
					return m, removeSecretCmd(m.client, selectedKey)
				}
				return m, nil

			case "s":
				if m.cursor < len(m.keys) {
					selectedKey := m.keys[m.cursor]
					m.assignSecret = selectedKey
					m.statusMsg = ""
					return m, loadAssignablesCmd(m.client, selectedKey)
				}
				return m, nil
			}

		case secretsModeAssign:
			switch msg.String() {
			case "esc":
				return m, m.saveAssignments()

			case "j", "down":
				if m.assignCursor < len(m.assignables)-1 {
					m.assignCursor++
				}
				return m, nil

			case "k", "up":
				if m.assignCursor > 0 {
					m.assignCursor--
				}
				return m, nil

			case " ", "enter":
				if m.assignCursor < len(m.assignables) {
					m.assignables[m.assignCursor].hasSecret = !m.assignables[m.assignCursor].hasSecret
				}
				return m, nil
			}

		case secretsModeAddName:
			switch msg.String() {
			case "enter":
				if m.nameInput.Value() != "" {
					m.mode = secretsModeAddValue
					m.valueInput.Reset()
					m.valueInput.Focus()
					return m, textinput.Blink
				}
				return m, nil

			case "esc":
				m.mode = secretsModeList
				return m, nil

			default:
				var cmd tea.Cmd
				m.nameInput, cmd = m.nameInput.Update(msg)
				return m, cmd
			}

		case secretsModeAddValue:
			switch msg.String() {
			case "enter":
				if m.valueInput.Value() != "" {
					name := m.nameInput.Value()
					value := m.valueInput.Value()
					m.mode = secretsModeList
					m.nameInput.Reset()
					m.valueInput.Reset()
					return m, setSecretCmd(m.client, name, value)
				}
				return m, nil

			case "esc":
				m.mode = secretsModeList
				return m, nil

			default:
				var cmd tea.Cmd
				m.valueInput, cmd = m.valueInput.Update(msg)
				return m, cmd
			}
		}
	}

	return m, nil
}

func (m *SecretsModel) saveAssignments() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		for _, entry := range m.assignables {
			had := containsSecret(entry.allSecrets, m.assignSecret)
			wants := entry.hasSecret
			if had == wants {
				continue
			}

			var newSecrets []string
			if wants {
				newSecrets = append(entry.allSecrets, m.assignSecret)
			} else {
				for _, s := range entry.allSecrets {
					if s != m.assignSecret {
						newSecrets = append(newSecrets, s)
					}
				}
			}

			if entry.isCustom {
				name := strings.TrimPrefix(entry.name, "customtool:")
				_, err := m.client.UpdateCustomToolSecrets(ctx, name, newSecrets)
				if err != nil {
					return secretsErrorMsg{err}
				}
			} else {
				_, err := m.client.UpdateSkillSecrets(ctx, entry.name, newSecrets)
				if err != nil {
					return secretsErrorMsg{err}
				}
			}
		}
		return secretsAssignSavedMsg{secret: m.assignSecret}
	}
}

func containsSecret(secrets []string, target string) bool {
	for _, s := range secrets {
		if s == target {
			return true
		}
	}
	return false
}

func (m *SecretsModel) View() tea.View {
	var view string

	if m.errorMsg != "" {
		view = lipgloss.NewStyle().
			Foreground(lipgloss.Color("1")).
			Render(fmt.Sprintf("Error: %s\n\n", m.errorMsg))
	}

	switch m.mode {
	case secretsModeList:
		view += "Secrets\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("─────────────────\n")

		if len(m.keys) == 0 {
			view += "(No secrets)\n"
		} else {
			for i, key := range m.keys {
				if i == m.cursor {
					view += lipgloss.NewStyle().
						Background(lipgloss.Color("4")).
						Foreground(lipgloss.Color("15")).
						Render(fmt.Sprintf("▸ %s", key)) + "\n"
				} else {
					view += fmt.Sprintf("  %s\n", key)
				}
			}
		}

		hint := "a/n: add  d: delete  s: assign tools  Escape: back"
		if m.statusMsg != "" {
			hint = m.statusMsg
		}
		view += "\n" + lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render(hint)

	case secretsModeAssign:
		view += fmt.Sprintf("Assign %s to tools/skills\n", m.assignSecret)
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("─────────────────\n")

		if len(m.assignables) == 0 {
			view += "(No skills or tools to assign)\n"
		} else {
			for i, entry := range m.assignables {
				check := "[ ]"
				if entry.hasSecret {
					check = "[✓]"
				}
				line := fmt.Sprintf("%s %s", check, entry.name)
				if i == m.assignCursor {
					view += lipgloss.NewStyle().
						Background(lipgloss.Color("4")).
						Foreground(lipgloss.Color("15")).
						Render("▸ "+line) + "\n"
				} else {
					view += fmt.Sprintf("  %s\n", line)
				}
			}
		}

		view += "\n" + lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("Space/Enter: toggle  Escape: save & back")

	case secretsModeAddName:
		view += "Add Secret\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("──────────\n")
		view += "Name:\n"
		view += m.nameInput.View() + "\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("(Press Enter to continue, Escape to cancel)")

	case secretsModeAddValue:
		view += "Add Secret\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("──────────\n")
		view += fmt.Sprintf("Name: %s\n", m.nameInput.Value())
		view += "Value:\n"
		view += m.valueInput.View() + "\n"
		view += lipgloss.NewStyle().
			Foreground(lipgloss.Color("8")).
			Render("(Press Enter to save, Escape to cancel)")
	}

	return tea.NewView(view)
}

// Message types

type secretsLoadedMsg struct {
	keys []string
}

type secretsErrorMsg struct {
	err error
}

type secretsAssignablesLoadedMsg struct {
	entries []assignableEntry
}

type secretsAssignSavedMsg struct {
	secret string
}

// Commands

func loadSecretsCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.ListSecrets(ctx)
		if err != nil {
			return secretsErrorMsg{err}
		}
		return secretsLoadedMsg{keys: result.Keys}
	}
}

func loadAssignablesCmd(client *protocol.Client, secretKey string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		var entries []assignableEntry

		grants, err := client.ListGrants(ctx)
		if err != nil {
			return secretsErrorMsg{err}
		}
		for _, g := range grants.Grants {
			entries = append(entries, assignableEntry{
				name:       g.SkillName,
				isCustom:   false,
				hasSecret:  containsSecret(g.Secrets, secretKey),
				allSecrets: g.Secrets,
			})
		}

		tools, err := client.ListCustomTools(ctx)
		if err != nil {
			return secretsErrorMsg{err}
		}
		for _, t := range tools.Tools {
			entries = append(entries, assignableEntry{
				name:       "customtool:" + t.Name,
				isCustom:   true,
				hasSecret:  containsSecret(t.Secrets, secretKey),
				allSecrets: t.Secrets,
			})
		}

		return secretsAssignablesLoadedMsg{entries: entries}
	}
}

func setSecretCmd(client *protocol.Client, key string, value string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.SetSecret(ctx, key, value)
		if err != nil {
			return secretsErrorMsg{err}
		}
		return loadSecretsCmd(client)()
	}
}

func removeSecretCmd(client *protocol.Client, key string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.RemoveSecret(ctx, key)
		if err != nil {
			return secretsErrorMsg{err}
		}
		return loadSecretsCmd(client)()
	}
}
