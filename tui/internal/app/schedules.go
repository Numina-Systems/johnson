// pattern: Imperative Shell
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"time"
)

type SchedulesModel struct {
	client *protocol.Client
	tasks  []protocol.TaskStateInfo
	cursor int
	width  int
	height int
	errorMsg string
}

func NewSchedulesModel(client *protocol.Client) *SchedulesModel {
	return &SchedulesModel{
		client:   client,
		tasks:    []protocol.TaskStateInfo{},
		cursor:   0,
		width:    80,
		height:   24,
	}
}

func (m *SchedulesModel) Init() tea.Cmd {
	return loadSchedulesCmd(m.client)
}

func (m *SchedulesModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case schedulesLoadedMsg:
		m.errorMsg = ""
		m.tasks = msg.tasks
		if m.cursor >= len(m.tasks) {
			m.cursor = 0
		}
		return m, nil

	case schedulesErrorMsg:
		m.errorMsg = msg.err.Error()
		return m, nil

	case tea.KeyPressMsg:
		switch msg.String() {
		case "escape":
			return m, func() tea.Msg { return backToSessionsMsg{} }

		case "j", "down":
			if m.cursor < len(m.tasks)-1 {
				m.cursor++
			}
			return m, nil

		case "k", "up":
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil

		case "e":
			if m.cursor < len(m.tasks) {
				task := m.tasks[m.cursor]
				return m, toggleScheduleEnabledCmd(m.client, task.ID, !task.Enabled)
			}
			return m, nil
		}
	}

	return m, nil
}

func (m *SchedulesModel) View() tea.View {
	var view string

	if m.errorMsg != "" {
		view = lipgloss.NewStyle().
			Foreground(lipgloss.Color("1")).
			Render(fmt.Sprintf("Error: %s\n\n", m.errorMsg))
	}

	view += "Scheduled Tasks\n"
	view += lipgloss.NewStyle().
		Foreground(lipgloss.Color("8")).
		Render("─────────────────\n")

	if len(m.tasks) == 0 {
		view += "(No scheduled tasks)\n"
	} else {
		for i, task := range m.tasks {
			var enabledBadge string
			if task.Enabled {
				enabledBadge = lipgloss.NewStyle().
					Foreground(lipgloss.Color("2")).
					Render("[enabled]")
			} else {
				enabledBadge = lipgloss.NewStyle().
					Foreground(lipgloss.Color("8")).
					Render("[disabled]")
			}

			var line string
			if i == m.cursor {
				line = fmt.Sprintf("▸ %s %s", task.Name, enabledBadge)
				view += lipgloss.NewStyle().
					Background(lipgloss.Color("4")).
					Foreground(lipgloss.Color("15")).
					Render(line) + "\n"
			} else {
				line = fmt.Sprintf("  %s %s", task.Name, enabledBadge)
				view += line + "\n"
			}

			// Schedule info
			view += fmt.Sprintf("    schedule: %s\n", task.Schedule)

			// Last run info
			var lastRunStr string
			if task.LastRun != nil {
				t, err := time.Parse(time.RFC3339, task.LastRun.StartedAt)
				if err == nil {
					statusStr := "FAIL"
					if task.LastRun.Success {
						statusStr = "OK"
					}
					durationSecs := float64(task.LastRun.DurationMs) / 1000.0
					lastRunStr = fmt.Sprintf("    last: %s %s %.1fs\n", t.Format("2006-01-02 15:04"), statusStr, durationSecs)
				} else {
					lastRunStr = fmt.Sprintf("    last: %s\n", task.LastRun.StartedAt)
				}
			} else {
				lastRunStr = "    last: never\n"
			}
			view += lastRunStr

			// Run count
			view += fmt.Sprintf("    runs: %d\n", task.RunCount)

			if i < len(m.tasks)-1 {
				view += "\n"
			}
		}
	}

	view += "\n" + lipgloss.NewStyle().
		Foreground(lipgloss.Color("8")).
		Render("e: toggle enabled  Escape: back")

	return tea.NewView(view)
}

// Message types

type schedulesLoadedMsg struct {
	tasks []protocol.TaskStateInfo
}

type schedulesErrorMsg struct {
	err error
}

// Commands

func loadSchedulesCmd(client *protocol.Client) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		result, err := client.ListSchedules(ctx)
		if err != nil {
			return schedulesErrorMsg{err}
		}
		return schedulesLoadedMsg{tasks: result.Tasks}
	}
}

func toggleScheduleEnabledCmd(client *protocol.Client, id string, enabled bool) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		_, err := client.SetScheduleEnabled(ctx, id, enabled)
		if err != nil {
			return schedulesErrorMsg{err}
		}
		return loadSchedulesCmd(client)()
	}
}
