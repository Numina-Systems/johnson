// pattern: Imperative Shell
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/list"
	"charm.land/bubbles/v2/viewport"
	"charm.land/lipgloss/v2"
)

type toolsMode int

const (
	toolsModeList toolsMode = iota
	toolsModeViewCode
	toolsModeEditSecrets
)

type ToolsModel struct {
	client       *protocol.Client
	tabs         []string
	activeTab    int
	skillList    list.Model
	customList   list.Model
	builtinList  list.Model
	mode         toolsMode
	codeViewer   viewport.Model
	secretNames  []string
	secretToggle []bool
	secretCursor int
	editTarget   string
	editIsSkill  bool
	errorMsg     string
	width        int
	height       int
}

func NewToolsModel(client *protocol.Client) *ToolsModel {
	skillDelegate := list.NewDefaultDelegate()
	skillDelegate.SetSpacing(0)
	customDelegate := list.NewDefaultDelegate()
	customDelegate.SetSpacing(0)
	builtinDelegate := list.NewDefaultDelegate()
	builtinDelegate.SetSpacing(0)

	m := &ToolsModel{
		client:      client,
		tabs:        []string{"Skills", "Custom Tools", "Builtins"},
		activeTab:   0,
		skillList:   list.New([]list.Item{}, skillDelegate, 80, 20),
		customList:  list.New([]list.Item{}, customDelegate, 80, 20),
		builtinList: list.New([]list.Item{}, builtinDelegate, 80, 20),
		mode:        toolsModeList,
		codeViewer:  viewport.New(),
		width:       80,
		height:      24,
	}
	return m
}

func (m *ToolsModel) Init() tea.Cmd {
	return tea.Batch(
		loadToolsSkillsCmd(m.client),
		loadToolsCustomToolsCmd(m.client),
		loadToolsBuiltinsCmd(m.client),
	)
}

func (m *ToolsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.skillList.SetSize(msg.Width, msg.Height-4)
		m.customList.SetSize(msg.Width, msg.Height-4)
		m.builtinList.SetSize(msg.Width, msg.Height-4)
		m.codeViewer.SetWidth(msg.Width)
		m.codeViewer.SetHeight(msg.Height - 4)

	case toolsSkillsLoadedMsg:
		m.errorMsg = ""
		items := make([]list.Item, len(msg.skills))
		for i, s := range msg.skills {
			items[i] = newSkillItem(s)
		}
		m.skillList.SetItems(items)

	case toolsCustomToolsLoadedMsg:
		m.errorMsg = ""
		items := make([]list.Item, len(msg.tools))
		for i, t := range msg.tools {
			items[i] = newCustomToolItem(t)
		}
		m.customList.SetItems(items)

	case toolsBuiltinsLoadedMsg:
		m.errorMsg = ""
		items := make([]list.Item, len(msg.builtins))
		for i, b := range msg.builtins {
			items[i] = newBuiltinItem(b)
		}
		m.builtinList.SetItems(items)

	case toolsErrorMsg:
		m.errorMsg = msg.err.Error()

	case tea.KeyPressMsg:
		switch m.mode {
		case toolsModeList:
			switch msg.String() {
			case "tab":
				m.activeTab = (m.activeTab + 1) % 3
				return m, nil
			case "shift+tab":
				m.activeTab = (m.activeTab + 3 - 1) % 3
				return m, nil

			case "escape":
				return m, func() tea.Msg { return popScreenMsg{} }

			case "a", "g", "r", "v", "s", "d":
				if m.activeTab == 0 { // Skills tab
					if selected, ok := m.skillList.SelectedItem().(skillItem); ok {
						switch msg.String() {
						case "g":
							return m, grantSkillCmd(m.client, selected.rkey)
						case "r":
							return m, revokeSkillCmd(m.client, selected.rkey)
						case "v":
							m.mode = toolsModeViewCode
							// TODO: Implement skill/get or add content field to SkillInfo to fetch actual skill source code.
							// Currently shows placeholder. This requires backend support to retrieve the skill document content.
							m.codeViewer.SetContent(fmt.Sprintf("[Code view for skill: %s]\n\n(Feature not yet fully implemented - would fetch from backend)\n\nPress Escape to return to list.", selected.rkey))
							return m, nil
						case "s":
							m.mode = toolsModeEditSecrets
							m.editTarget = selected.rkey
							m.editIsSkill = true
							m.secretNames = selected.secrets
							m.secretToggle = make([]bool, len(selected.secrets))
							m.secretCursor = 0
							return m, nil
						case "d":
							return m, deleteSkillCmd(m.client, selected.rkey)
						}
					}
				} else if m.activeTab == 1 { // Custom Tools tab
					if selected, ok := m.customList.SelectedItem().(customToolItem); ok {
						switch msg.String() {
						case "a":
							return m, approveCustomToolCmd(m.client, selected.name)
						case "r":
							return m, revokeCustomToolCmd(m.client, selected.name)
						case "v":
							m.mode = toolsModeViewCode
							// TODO: Implement customTool/get or add content field to CustomToolInfo to fetch actual tool source code.
							// Currently shows placeholder. This requires backend support to retrieve the custom tool document content.
							m.codeViewer.SetContent(fmt.Sprintf("[Code view for tool: %s]\n\n(Feature not yet fully implemented - would fetch from backend)\n\nPress Escape to return to list.", selected.name))
							return m, nil
						case "s":
							m.mode = toolsModeEditSecrets
							m.editTarget = selected.name
							m.editIsSkill = false
							m.secretNames = selected.secrets
							m.secretToggle = make([]bool, len(selected.secrets))
							m.secretCursor = 0
							return m, nil
						}
					}
				}
			}

		case toolsModeViewCode:
			switch msg.String() {
			case "escape":
				m.mode = toolsModeList
				return m, nil
			}
			m.codeViewer, cmd = m.codeViewer.Update(msg)
			return m, cmd

		case toolsModeEditSecrets:
			switch msg.String() {
			case "escape":
				m.mode = toolsModeList
				selected := make([]string, 0)
				for i, toggled := range m.secretToggle {
					if toggled {
						selected = append(selected, m.secretNames[i])
					}
				}
				if m.editIsSkill {
					return m, updateSkillSecretsCmd(m.client, m.editTarget, selected)
				} else {
					return m, updateCustomToolSecretsCmd(m.client, m.editTarget, selected)
				}

			case "j", "down":
				if m.secretCursor < len(m.secretNames)-1 {
					m.secretCursor++
				}
				return m, nil

			case "k", "up":
				if m.secretCursor > 0 {
					m.secretCursor--
				}
				return m, nil

			case " ", "enter":
				if m.secretCursor < len(m.secretToggle) {
					m.secretToggle[m.secretCursor] = !m.secretToggle[m.secretCursor]
				}
				return m, nil
			}
		}
	}

	// Delegate to active list when in list mode
	if m.mode == toolsModeList {
		switch m.activeTab {
		case 0:
			m.skillList, cmd = m.skillList.Update(msg)
		case 1:
			m.customList, cmd = m.customList.Update(msg)
		case 2:
			m.builtinList, cmd = m.builtinList.Update(msg)
		}
		return m, cmd
	}

	return m, nil
}

func (m *ToolsModel) View() tea.View {
	var view string

	if m.errorMsg != "" {
		view = fmt.Sprintf("Error: %s\n\n", m.errorMsg)
	}

	switch m.mode {
	case toolsModeList:
		// Render tabs
		var tabLine string
		for i, tab := range m.tabs {
			if i == m.activeTab {
				tabLine += lipgloss.NewStyle().
					Bold(true).
					Foreground(lipgloss.Color("white")).
					Background(lipgloss.Color("4")).
					Padding(0, 2).
					Render(tab)
			} else {
				tabLine += lipgloss.NewStyle().
					Padding(0, 2).
					Render(tab)
			}
			if i < len(m.tabs)-1 {
				tabLine += " "
			}
		}
		view += tabLine + "\n"

		// Render active list
		switch m.activeTab {
		case 0:
			view += m.skillList.View()
		case 1:
			view += m.customList.View()
		case 2:
			view += m.builtinList.View()
		}

	case toolsModeViewCode:
		view += m.codeViewer.View()

	case toolsModeEditSecrets:
		view += "Select secrets (Space/Enter to toggle, Escape to save):\n"
		// Note: Currently only shows assigned secrets. In Phase 5, when secret/listKeys
		// is available in the backend, this will be updated to show all available
		// secrets from the vault, allowing users to add new secret assignments.
		if len(m.secretNames) == 0 {
			view += "\n(No secrets assigned. Use the Secrets screen (Ctrl+S) to manage secrets.)\n"
		}
		for i, name := range m.secretNames {
			var line string
			if i == m.secretCursor {
				if m.secretToggle[i] {
					line = fmt.Sprintf("▸ ✓ %s", name)
				} else {
					line = fmt.Sprintf("▸ ☐ %s", name)
				}
				view += lipgloss.NewStyle().
					Background(lipgloss.Color("4")).
					Render(line) + "\n"
			} else {
				if m.secretToggle[i] {
					line = fmt.Sprintf("  ✓ %s", name)
				} else {
					line = fmt.Sprintf("  ☐ %s", name)
				}
				view += line + "\n"
			}
		}
	}

	return tea.NewView(view)
}

// Item types

type skillItem struct {
	rkey        string
	description string
	grantStatus *string
	secrets     []string
}

func newSkillItem(s protocol.SkillInfo) skillItem {
	desc := ""
	if s.Description != nil {
		desc = *s.Description
	}
	return skillItem{
		rkey:        s.Rkey,
		description: desc,
		grantStatus: s.GrantStatus,
		secrets:     s.Secrets,
	}
}

func (s skillItem) FilterValue() string {
	return s.rkey
}

func (s skillItem) Title() string {
	name := s.rkey
	if len(name) > 6 && name[:6] == "skill:" {
		name = name[6:]
	}
	status := ""
	if s.grantStatus != nil {
		status = fmt.Sprintf(" [%s]", *s.grantStatus)
	}
	return name + status
}

func (s skillItem) Description() string {
	return s.description
}

type customToolItem struct {
	name        string
	description string
	approved    bool
	secrets     []string
}

func newCustomToolItem(t protocol.CustomToolInfo) customToolItem {
	return customToolItem{
		name:        t.Name,
		description: t.Description,
		approved:    t.Approved,
		secrets:     t.Secrets,
	}
}

func (c customToolItem) FilterValue() string {
	return c.name
}

func (c customToolItem) Title() string {
	status := "unapproved"
	if c.approved {
		status = "approved"
	}
	return fmt.Sprintf("%s [%s]", c.name, status)
}

func (c customToolItem) Description() string {
	return c.description
}

type builtinItem struct {
	name        string
	description string
}

func newBuiltinItem(b protocol.BuiltinToolInfo) builtinItem {
	return builtinItem{
		name:        b.Name,
		description: b.Description,
	}
}

func (b builtinItem) FilterValue() string {
	return b.name
}

func (b builtinItem) Title() string {
	return b.name
}

func (b builtinItem) Description() string {
	return b.description
}

// Message types

type toolsSkillsLoadedMsg struct {
	skills []protocol.SkillInfo
}

type toolsCustomToolsLoadedMsg struct {
	tools []protocol.CustomToolInfo
}

type toolsBuiltinsLoadedMsg struct {
	builtins []protocol.BuiltinToolInfo
}

type toolsErrorMsg struct {
	err error
}

// Commands

func loadToolsSkillsCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.ListSkills(ctx)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return toolsSkillsLoadedMsg{skills: result.Skills}
	}
}

func loadToolsCustomToolsCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.ListCustomTools(ctx)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return toolsCustomToolsLoadedMsg{tools: result.Tools}
	}
}

func loadToolsBuiltinsCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.ListBuiltins(ctx)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return toolsBuiltinsLoadedMsg{builtins: result.Tools}
	}
}

func grantSkillCmd(client *protocol.Client, rkey string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.GrantSkill(ctx, rkey, "granted")
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsSkillsCmd(client)()
	}
}

func revokeSkillCmd(client *protocol.Client, rkey string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.GrantSkill(ctx, rkey, "revoked")
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsSkillsCmd(client)()
	}
}

func deleteSkillCmd(client *protocol.Client, rkey string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.DeleteSkill(ctx, rkey)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsSkillsCmd(client)()
	}
}

func approveCustomToolCmd(client *protocol.Client, name string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.ApproveCustomTool(ctx, name)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsCustomToolsCmd(client)()
	}
}

func revokeCustomToolCmd(client *protocol.Client, name string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.RevokeCustomTool(ctx, name)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsCustomToolsCmd(client)()
	}
}

func updateSkillSecretsCmd(client *protocol.Client, rkey string, secrets []string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.UpdateSkillSecrets(ctx, rkey, secrets)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsSkillsCmd(client)()
	}
}

func updateCustomToolSecretsCmd(client *protocol.Client, name string, secrets []string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.UpdateCustomToolSecrets(ctx, name, secrets)
		if err != nil {
			return toolsErrorMsg{err}
		}
		return loadToolsCustomToolsCmd(client)()
	}
}
