// pattern: Imperative Shell
package app

import (
	"fmt"
	"io"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/list"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// sessionDelegate renders sessions in a compact single-line format.
type sessionDelegate struct{}

func newSessionDelegate() list.ItemDelegate {
	return sessionDelegate{}
}

func (d sessionDelegate) Height() int {
	return 1
}

func (d sessionDelegate) Spacing() int {
	return 0
}

func (d sessionDelegate) Update(msg tea.Msg, m *list.Model) tea.Cmd {
	return nil
}

func (d sessionDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	s, ok := item.(sessionItem)
	if !ok {
		return
	}

	title := s.Title()
	meta := fmt.Sprintf("%d msgs · %s", s.messageCount, s.updatedAt)

	isSelected := index == m.Index()

	prefix := "  "
	if isSelected {
		prefix = "▸ "
	}

	// Compute available width: total width minus prefix and padding
	availWidth := m.Width() - lipgloss.Width(prefix) - 2
	metaWidth := lipgloss.Width(meta)
	titleWidth := availWidth - metaWidth - 2 // 2 chars gap between title and meta

	if titleWidth < 10 {
		titleWidth = 10
	}

	// Truncate title if needed
	if lipgloss.Width(title) > titleWidth {
		title = ansi.Truncate(title, titleWidth, "…")
	}

	// Pad title to fill available space before metadata
	gap := availWidth - lipgloss.Width(title) - metaWidth
	if gap < 1 {
		gap = 1
	}

	dimStyle := lipgloss.NewStyle().Faint(true)
	line := prefix + title + strings.Repeat(" ", gap) + dimStyle.Render(meta)

	if isSelected {
		line = lipgloss.NewStyle().
			Background(lipgloss.Color("4")).
			Foreground(lipgloss.Color("15")).
			Render(line)
	}

	fmt.Fprint(w, line)
}
