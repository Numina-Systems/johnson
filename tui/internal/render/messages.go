// pattern: Imperative Shell
package render

import (
	"fmt"
	"strings"

	"charm.land/glamour/v2"
	"charm.land/lipgloss/v2"
)

type Renderer struct {
	glamour *glamour.TermRenderer
	width   int
}

func NewRenderer(width int) (*Renderer, error) {
	r, err := glamour.NewTermRenderer(
		glamour.WithWordWrap(width - 4),
		glamour.WithStandardStyle("dark"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create glamour renderer: %w", err)
	}
	return &Renderer{glamour: r, width: width}, nil
}

func (r *Renderer) SetWidth(width int) error {
	renderer, err := glamour.NewTermRenderer(
		glamour.WithWordWrap(width - 4),
		glamour.WithStandardStyle("dark"),
	)
	if err != nil {
		return err
	}
	r.glamour = renderer
	r.width = width
	return nil
}

var userStyle = lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("#7D56F4"))

var agentStyle = lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("#04B575"))

func (r *Renderer) RenderUserMessage(content string) string {
	prefix := userStyle.Render("you> ")
	return prefix + content + "\n"
}

func (r *Renderer) RenderAgentMessage(content string) string {
	prefix := agentStyle.Render("agent> ")
	rendered, err := r.glamour.Render(content)
	if err != nil {
		return prefix + content + "\n"
	}
	rendered = strings.TrimRight(rendered, "\n")
	return prefix + rendered + "\n"
}
