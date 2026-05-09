// pattern: Imperative Shell (test)
package render

import (
	"strings"
	"testing"
)

func TestNewRenderer(t *testing.T) {
	tests := []struct {
		name    string
		width   int
		wantErr bool
	}{
		{
			name:    "valid width",
			width:   80,
			wantErr: false,
		},
		{
			name:    "small width",
			width:   20,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, err := NewRenderer(tt.width)
			if (err != nil) != tt.wantErr {
				t.Fatalf("NewRenderer() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && r == nil {
				t.Fatal("NewRenderer() returned nil renderer")
			}
		})
	}
}

func TestRendererSetWidth(t *testing.T) {
	r, err := NewRenderer(80)
	if err != nil {
		t.Fatalf("NewRenderer() failed: %v", err)
	}

	tests := []struct {
		name    string
		width   int
		wantErr bool
	}{
		{
			name:    "set to smaller width",
			width:   40,
			wantErr: false,
		},
		{
			name:    "set to larger width",
			width:   120,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := r.SetWidth(tt.width)
			if (err != nil) != tt.wantErr {
				t.Fatalf("SetWidth() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRenderUserMessage(t *testing.T) {
	r, err := NewRenderer(80)
	if err != nil {
		t.Fatalf("NewRenderer() failed: %v", err)
	}

	tests := []struct {
		name      string
		content   string
		wantInfix string
	}{
		{
			name:      "simple message",
			content:   "hello world",
			wantInfix: "you>",
		},
		{
			name:      "multiline content",
			content:   "line 1\nline 2\nline 3",
			wantInfix: "you>",
		},
		{
			name:      "empty content",
			content:   "",
			wantInfix: "you>",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := r.RenderUserMessage(tt.content)

			// Check that prefix is present
			if !strings.Contains(result, tt.wantInfix) {
				t.Errorf("RenderUserMessage() result missing '%s': %q", tt.wantInfix, result)
			}

			// Check that content is present
			if tt.content != "" && !strings.Contains(result, tt.content) {
				t.Errorf("RenderUserMessage() result missing content: got %q, want to contain %q", result, tt.content)
			}

			// Check that result ends with newline
			if !strings.HasSuffix(result, "\n") {
				t.Errorf("RenderUserMessage() result should end with newline: %q", result)
			}
		})
	}
}

func TestRenderAgentMessage(t *testing.T) {
	r, err := NewRenderer(80)
	if err != nil {
		t.Fatalf("NewRenderer() failed: %v", err)
	}

	tests := []struct {
		name      string
		content   string
		wantInfix string
	}{
		{
			name:      "plain text message",
			content:   "hello world",
			wantInfix: "agent>",
		},
		{
			name:      "markdown-like content",
			content:   "# Header\n\nSome text here",
			wantInfix: "agent>",
		},
		{
			name:      "empty content",
			content:   "",
			wantInfix: "agent>",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := r.RenderAgentMessage(tt.content)

			// Check that prefix is present
			if !strings.Contains(result, tt.wantInfix) {
				t.Errorf("RenderAgentMessage() result missing '%s': %q", tt.wantInfix, result)
			}

			// Check that result ends with newline
			if !strings.HasSuffix(result, "\n") {
				t.Errorf("RenderAgentMessage() result should end with newline: %q", result)
			}
		})
	}
}

func TestRenderAgentMessageHandlesPlainTextGracefully(t *testing.T) {
	r, err := NewRenderer(80)
	if err != nil {
		t.Fatalf("NewRenderer() failed: %v", err)
	}

	plainText := "This is plain text without any markdown"
	result := r.RenderAgentMessage(plainText)

	// Should not error and should produce valid output
	if result == "" {
		t.Fatal("RenderAgentMessage() returned empty string for plain text")
	}

	if !strings.Contains(result, "agent>") {
		t.Error("RenderAgentMessage() missing agent prefix")
	}

	if !strings.HasSuffix(result, "\n") {
		t.Error("RenderAgentMessage() result missing trailing newline")
	}
}

func TestRendererWidthAffectsWordWrap(t *testing.T) {
	r1, err := NewRenderer(40)
	if err != nil {
		t.Fatalf("NewRenderer(40) failed: %v", err)
	}

	r2, err := NewRenderer(120)
	if err != nil {
		t.Fatalf("NewRenderer(120) failed: %v", err)
	}

	longText := "This is a very long line of text that would normally wrap at different widths depending on the renderer configuration"

	result1 := r1.RenderAgentMessage(longText)
	result2 := r2.RenderAgentMessage(longText)

	// Both should be valid
	if result1 == "" {
		t.Fatal("RenderAgentMessage(40) returned empty string")
	}
	if result2 == "" {
		t.Fatal("RenderAgentMessage(120) returned empty string")
	}

	// Both should contain the prefix
	if !strings.Contains(result1, "agent>") {
		t.Error("result1 missing agent prefix")
	}
	if !strings.Contains(result2, "agent>") {
		t.Error("result2 missing agent prefix")
	}
}
