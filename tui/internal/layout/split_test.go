// pattern: Imperative Shell (test)
package layout

import (
	"testing"
)

func TestComputeChatLayout(t *testing.T) {
	tests := []struct {
		name        string
		totalWidth  int
		totalHeight int
		inputLines  int
		validate    func(*testing.T, ChatLayout)
	}{
		{
			name:        "normal terminal size",
			totalWidth:  80,
			totalHeight: 24,
			inputLines:  1,
			validate: func(t *testing.T, layout ChatLayout) {
				if layout.Width != 80 {
					t.Errorf("Width: got %d, want 80", layout.Width)
				}
				if layout.HeaderHeight != 1 {
					t.Errorf("HeaderHeight: got %d, want 1", layout.HeaderHeight)
				}
				if layout.StatusHeight != 2 {
					t.Errorf("StatusHeight: got %d, want 2", layout.StatusHeight)
				}
				if layout.InputHeight != 2 {
					t.Errorf("InputHeight: got %d, want 2 (inputLines + 1)", layout.InputHeight)
				}
				if layout.ViewportHeight <= 0 {
					t.Errorf("ViewportHeight should be positive, got %d", layout.ViewportHeight)
				}
			},
		},
		{
			name:        "input height capped at 4",
			totalWidth:  80,
			totalHeight: 24,
			inputLines:  10,
			validate: func(t *testing.T, layout ChatLayout) {
				if layout.InputHeight != 4 {
					t.Errorf("InputHeight: got %d, want 4 (capped)", layout.InputHeight)
				}
			},
		},
		{
			name:        "large terminal gives more viewport space",
			totalWidth:  200,
			totalHeight: 50,
			inputLines:  2,
			validate: func(t *testing.T, layout ChatLayout) {
				if layout.Width != 200 {
					t.Errorf("Width: got %d, want 200", layout.Width)
				}
				if layout.ViewportHeight < 40 {
					t.Errorf("ViewportHeight should be large on large terminal, got %d", layout.ViewportHeight)
				}
			},
		},
		{
			name:        "very small terminal still works",
			totalWidth:  40,
			totalHeight: 10,
			inputLines:  1,
			validate: func(t *testing.T, layout ChatLayout) {
				// Heights must be positive
				if layout.HeaderHeight <= 0 {
					t.Errorf("HeaderHeight should be positive, got %d", layout.HeaderHeight)
				}
				if layout.StatusHeight <= 0 {
					t.Errorf("StatusHeight should be positive, got %d", layout.StatusHeight)
				}
				if layout.InputHeight <= 0 {
					t.Errorf("InputHeight should be positive, got %d", layout.InputHeight)
				}
				// Viewport height has minimum of 3
				if layout.ViewportHeight < 3 {
					t.Errorf("ViewportHeight should be at least 3, got %d", layout.ViewportHeight)
				}
			},
		},
		{
			name:        "minimum viewport height is 3",
			totalWidth:  80,
			totalHeight: 8,
			inputLines:  3,
			validate: func(t *testing.T, layout ChatLayout) {
				if layout.ViewportHeight < 3 {
					t.Errorf("ViewportHeight: got %d, want at least 3", layout.ViewportHeight)
				}
			},
		},
		{
			name:        "zero input lines",
			totalWidth:  80,
			totalHeight: 24,
			inputLines:  0,
			validate: func(t *testing.T, layout ChatLayout) {
				// 0 input lines + 1 for border = 1
				if layout.InputHeight != 1 {
					t.Errorf("InputHeight: got %d, want 1", layout.InputHeight)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			layout := ComputeChatLayout(tt.totalWidth, tt.totalHeight, tt.inputLines)
			tt.validate(t, layout)
		})
	}
}

func TestComputeChatLayoutHeightsReasonable(t *testing.T) {
	// Test that the sum of heights is within reasonable bounds
	// (viewport is clamped to minimum 3, so it's possible that sum > total height
	// when terminal is very small, but this is acceptable)
	testCases := []struct {
		width  int
		height int
		input  int
	}{
		{80, 24, 1},
		{200, 50, 5},
		{40, 15, 2},
		{120, 30, 3},
	}

	for _, tc := range testCases {
		layout := ComputeChatLayout(tc.width, tc.height, tc.input)

		// All components should be positive
		if layout.HeaderHeight <= 0 {
			t.Errorf("HeaderHeight should be positive, got %d", layout.HeaderHeight)
		}
		if layout.StatusHeight <= 0 {
			t.Errorf("StatusHeight should be positive, got %d", layout.StatusHeight)
		}
		if layout.InputHeight <= 0 {
			t.Errorf("InputHeight should be positive, got %d", layout.InputHeight)
		}
		if layout.ViewportHeight < 3 {
			t.Errorf("ViewportHeight should be at least 3, got %d", layout.ViewportHeight)
		}
	}
}

func TestComputeChatLayoutNoNegativeHeights(t *testing.T) {
	// Test extreme cases to ensure no negative heights are produced
	testCases := []struct {
		width  int
		height int
		input  int
	}{
		{1, 1, 0},
		{10, 5, 5},
		{80, 3, 10},
	}

	for _, tc := range testCases {
		layout := ComputeChatLayout(tc.width, tc.height, tc.input)
		if layout.HeaderHeight < 0 {
			t.Errorf("HeaderHeight is negative: %d", layout.HeaderHeight)
		}
		if layout.StatusHeight < 0 {
			t.Errorf("StatusHeight is negative: %d", layout.StatusHeight)
		}
		if layout.InputHeight < 0 {
			t.Errorf("InputHeight is negative: %d", layout.InputHeight)
		}
		if layout.ViewportHeight < 0 {
			t.Errorf("ViewportHeight is negative: %d", layout.ViewportHeight)
		}
	}
}
