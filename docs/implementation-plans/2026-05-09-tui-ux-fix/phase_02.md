# TUI UX Fix Implementation Plan — Phase 2: List Density & Session Delegate

**Goal:** Compact list rendering across all screens with a custom single-line delegate for sessions.

**Architecture:** Create a custom `ItemDelegate` for the sessions list that renders each session on one line with title left-aligned and metadata right-aligned. Configure `DefaultDelegate` with `SetSpacing(0)` for tool lists. Remove blank-line separators in the schedules custom renderer. Secrets already render one item per line — no changes needed.

**Tech Stack:** Go, Bubble Tea v2, lipgloss v2

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-ux-fix.AC4: Session list renders with compact item density
- **tui-ux-fix.AC4.1 Success:** Each session occupies exactly one line with title and metadata inline
- **tui-ux-fix.AC4.2 Success:** Selected session has visual highlight (background colour and `▸` prefix)
- **tui-ux-fix.AC4.3 Success:** Untitled sessions display truncated session ID
- **tui-ux-fix.AC4.4 Success:** List filtering/search works on session titles
- **tui-ux-fix.AC4.5 Edge:** Session list with 0 items shows empty state message

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create compact session delegate

**Verifies:** tui-ux-fix.AC4.1, tui-ux-fix.AC4.2, tui-ux-fix.AC4.3, tui-ux-fix.AC4.4

**Files:**
- Create: `tui/internal/app/session_delegate.go`
- Modify: `tui/internal/app/sessions.go:25` (replace `NewDefaultDelegate()` with custom delegate)
- Modify: `tui/internal/app/sessions.go:108-123` (update `FilterValue()` and `Title()` for truncated IDs)

**Implementation:**

Create `tui/internal/app/session_delegate.go` implementing the `list.ItemDelegate` interface with `Height()=1`, `Spacing()=0`.

The delegate renders each session as a single line:
```
▸ email-digest                    62 msgs · 10 min ago
  live-news-briefing              12 msgs · 22h ago
```

Title left-aligned, metadata (message count + updatedAt) right-aligned and dimmed. Selected item gets highlight background and `▸` prefix. Unselected items get `  ` (two spaces) prefix.

Untitled sessions display truncated session ID: `session 2af671...` (first 6 chars of ID + ellipsis).

The delegate uses `lipgloss` for styling. It must handle width truncation — title truncated if it would overlap metadata. The list model's width is available via the `m` parameter passed to `Render()`.

The `Render()` implementation:

```go
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
		title = ansi.Truncate(title, titleWidth, "…") // github.com/charmbracelet/x/ansi
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
```

The `ansi` package is `github.com/charmbracelet/x/ansi` — already a dependency in `go.sum`. Import it as `"github.com/charmbracelet/x/ansi"`. Also import `"strings"` for `strings.Repeat` and `"io"` for `io.Writer`.

Update `sessionItem.Title()` in `sessions.go` to show truncated ID for untitled sessions:

```go
func (s sessionItem) Title() string {
	if s.title != nil {
		return *s.title
	}
	if len(s.id) > 6 {
		return "session " + s.id[:6] + "..."
	}
	return "session " + s.id
}
```

Update `FilterValue()` similarly:

```go
func (s sessionItem) FilterValue() string {
	if s.title != nil {
		return *s.title
	}
	return "session " + s.id
}
```

Replace the delegate in `NewSessionsModel`:

```go
list: list.New([]list.Item{}, newSessionDelegate(), 80, 24),
```

**Testing:**

Tests must verify:
- tui-ux-fix.AC4.1: Delegate `Height()` returns 1, `Spacing()` returns 0
- tui-ux-fix.AC4.2: Render output for selected item contains `▸` prefix and highlight styling
- tui-ux-fix.AC4.3: `Title()` of untitled session (nil title) returns truncated ID format
- tui-ux-fix.AC4.4: `FilterValue()` returns title when present, full session ID when not

Test the delegate directly: create a `sessionDelegate`, call `Height()`, `Spacing()`, and verify return values. Test `sessionItem.Title()` and `FilterValue()` with nil title and with a title set.

For render testing, construct a `bytes.Buffer` as the `io.Writer`, call `Render()` with a mock list model and items, and verify the output string contains expected content (the `▸` prefix for selected, metadata text for all items).

Follow project testing pattern: standard `testing` package, table-driven tests, `t.Errorf`.

**Verification:**

```bash
cd tui && go test ./internal/app/ -run "TestSessionDelegate|TestSessionItem"
```

Expected: All tests pass.

**Commit:** `feat(tui): add compact single-line session delegate`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Configure `SetSpacing(0)` on tool lists

**Verifies:** None (density improvement, not covered by specific AC)

**Files:**
- Modify: `tui/internal/app/tools.go:41-54` (configure delegate spacing on all three lists)

**Implementation:**

In `NewToolsModel`, after creating each list, configure the default delegate with `SetSpacing(0)`:

```go
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
```

Descriptions remain visible — `ShowDescription` defaults to `true`, which keeps the 2-line height per item. Only the gap between items is removed.

**Testing:**

This is a visual density change. Verified operationally by confirming tool lists render without gaps between items.

**Verification:**

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

**Commit:** `feat(tui): remove spacing between tool list items`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Remove blank-line separators in schedules renderer

**Verifies:** None (density improvement, not covered by specific AC)

**Files:**
- Modify: `tui/internal/app/schedules.go` (View method, remove blank line between items)

**Implementation:**

In the schedules `View()` method, the current rendering adds a blank line between items:

```go
if i < len(m.tasks)-1 {
    view += "\n"
}
```

Remove this conditional blank line to compact the schedule list.

**Testing:**

Visual density change. Verified operationally.

**Verification:**

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

**Commit:** `feat(tui): compact schedule list density`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Run full test suite and verify Phase 2 changes

**Verifies:** tui-ux-fix.AC4.1, tui-ux-fix.AC4.2, tui-ux-fix.AC4.3, tui-ux-fix.AC4.4, tui-ux-fix.AC4.5

**Files:**
- No modifications — verification only

**Verification:**

```bash
cd tui && go test ./...
```

Expected: All tests pass, including new session delegate tests.

```bash
cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/
```

Expected: Build succeeds.

Note: tui-ux-fix.AC4.5 (empty state message with 0 items) is handled by the Bubble Tea `list.Model` built-in empty state — verified by checking that a session list with 0 items shows a message rather than blank space. This is default list behaviour and does not require custom implementation.

**Commit:** No commit — verification step only.
<!-- END_TASK_4 -->
