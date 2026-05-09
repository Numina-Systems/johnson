// pattern: Functional Core

package layout

type ChatLayout struct {
	HeaderHeight   int
	StatusHeight   int
	InputHeight    int
	ViewportHeight int
	Width          int
}

func ComputeChatLayout(totalWidth, totalHeight, inputLines int) ChatLayout {
	headerHeight := 1
	statusHeight := 2
	inputHeight := inputLines + 1 // +1 for border
	if inputHeight > 4 {
		inputHeight = 4
	}

	borderLines := 3 // borders between panes
	viewportHeight := totalHeight - headerHeight - statusHeight - inputHeight - borderLines
	if viewportHeight < 3 {
		viewportHeight = 3
	}

	return ChatLayout{
		HeaderHeight:   headerHeight,
		StatusHeight:   statusHeight,
		InputHeight:    inputHeight,
		ViewportHeight: viewportHeight,
		Width:          totalWidth,
	}
}
