// pattern: Imperative Shell (test)
package app

import (
	"constellation-tui/internal/protocol"
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

func newSchedulesClient() *protocol.Client {
	nullReader := nopReadCloser{io.Reader(io.LimitReader(io.Reader(nil), 0))}
	nullWriter := nopWriteCloser{io.Writer(io.Discard)}

	ctx := context.Background()
	client, err := protocol.NewClient(ctx, nullReader, nullWriter)
	if err != nil {
		panic(fmt.Sprintf("failed to create schedules client: %v", err))
	}
	return client
}

func TestNewSchedulesModel_InitialState(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	if len(model.tasks) != 0 {
		t.Errorf("expected initial tasks to be empty, got %d", len(model.tasks))
	}

	if model.cursor != 0 {
		t.Errorf("expected initial cursor to be 0, got %d", model.cursor)
	}

	if model.errorMsg != "" {
		t.Errorf("expected initial error message to be empty, got %q", model.errorMsg)
	}

	if model.width != 80 || model.height != 24 {
		t.Errorf("expected initial size 80x24, got %dx%d", model.width, model.height)
	}
}

func TestSchedulesModel_SchedulesLoadedMsg_PopulatesTasks(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	tasks := []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Daily Report",
			Schedule: "0 9 * * *",
			Enabled:  true,
			RunCount: 5,
		},
		{
			ID:       "task-2",
			Name:     "Hourly Sync",
			Schedule: "0 * * * *",
			Enabled:  false,
			RunCount: 10,
		},
	}
	msg := schedulesLoadedMsg{tasks: tasks}

	_, cmd := model.Update(msg)

	if len(model.tasks) != 2 {
		t.Errorf("expected 2 tasks, got %d", len(model.tasks))
	}

	if model.tasks[0].Name != "Daily Report" {
		t.Errorf("expected first task name to be 'Daily Report', got %q", model.tasks[0].Name)
	}

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}

	if cmd != nil {
		t.Error("expected no command for schedulesLoadedMsg")
	}
}

func TestSchedulesModel_SchedulesLoadedMsg_ResetsErrorMsg(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	model.errorMsg = "previous error"
	msg := schedulesLoadedMsg{tasks: []protocol.TaskStateInfo{}}

	_, _ = model.Update(msg)

	if model.errorMsg != "" {
		t.Errorf("expected error message to be cleared, got %q", model.errorMsg)
	}
}

func TestSchedulesModel_KeyPress_Toggle_Enabled(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
		},
	}
	model.cursor = 0

	msg := tea.KeyPressMsg(tea.Key{Code: 'e'})
	_, cmd := model.Update(msg)

	if cmd == nil {
		t.Error("expected command to toggle task")
	}
}

func TestSchedulesModel_KeyPress_Cursor_Down(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
		{ID: "task-3", Name: "Task 3"},
	}
	model.cursor = 0

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	_, _ = model.Update(msg)

	if model.cursor != 1 {
		t.Errorf("expected cursor to move to 1, got %d", model.cursor)
	}
}

func TestSchedulesModel_KeyPress_Cursor_Up(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
		{ID: "task-3", Name: "Task 3"},
	}
	model.cursor = 2

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})
	_, _ = model.Update(msg)

	if model.cursor != 1 {
		t.Errorf("expected cursor to move to 1, got %d", model.cursor)
	}
}

func TestSchedulesModel_KeyPress_Cursor_JKey(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
	}
	model.cursor = 0

	msg := tea.KeyPressMsg(tea.Key{Code: 'j'})
	_, _ = model.Update(msg)

	if model.cursor != 1 {
		t.Errorf("expected cursor to move to 1 with 'j', got %d", model.cursor)
	}
}

func TestSchedulesModel_KeyPress_Cursor_KKey(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
	}
	model.cursor = 1

	msg := tea.KeyPressMsg(tea.Key{Code: 'k'})
	_, _ = model.Update(msg)

	if model.cursor != 0 {
		t.Errorf("expected cursor to move to 0 with 'k', got %d", model.cursor)
	}
}

func TestSchedulesModel_KeyPress_Cursor_BoundedDown(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
	}
	model.cursor = 1

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyDown})
	_, _ = model.Update(msg)

	if model.cursor != 1 {
		t.Errorf("expected cursor to stay at 1, got %d", model.cursor)
	}
}

func TestSchedulesModel_KeyPress_Cursor_BoundedUp(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{ID: "task-1", Name: "Task 1"},
		{ID: "task-2", Name: "Task 2"},
	}
	model.cursor = 0

	msg := tea.KeyPressMsg(tea.Key{Code: tea.KeyUp})
	_, _ = model.Update(msg)

	if model.cursor != 0 {
		t.Errorf("expected cursor to stay at 0, got %d", model.cursor)
	}
}

func TestSchedulesModel_NavigationReady(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	// Verify the model is ready for navigation
	// Escape key handling is tested in integration tests.
	if model.cursor != 0 {
		t.Error("initial cursor should be 0")
	}
}

func TestSchedulesModel_View_ShowsTaskNames(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Daily Report",
			Schedule: "0 9 * * *",
			Enabled:  true,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "Daily Report") {
		t.Error("expected view to contain task name 'Daily Report'")
	}
}

func TestSchedulesModel_View_ShowsEnabledBadge(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "[enabled]") {
		t.Error("expected view to contain '[enabled]' badge for enabled task")
	}
}

func TestSchedulesModel_View_ShowsDisabledBadge(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  false,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "[disabled]") {
		t.Error("expected view to contain '[disabled]' badge for disabled task")
	}
}

func TestSchedulesModel_View_ShowsScheduleInfo(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Daily Report",
			Schedule: "0 9 * * *",
			Enabled:  true,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "0 9 * * *") {
		t.Error("expected view to contain schedule '0 9 * * *'")
	}

	if !contains(view.Content, "schedule:") {
		t.Error("expected view to contain 'schedule:' label")
	}
}

func TestSchedulesModel_View_ShowsRunCount(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
			RunCount: 42,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "runs: 42") {
		t.Error("expected view to contain 'runs: 42'")
	}
}

func TestSchedulesModel_View_ShowsLastRunNever(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
			LastRun:  nil,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "last: never") {
		t.Error("expected view to show 'last: never' when task never run")
	}
}

func TestSchedulesModel_View_ShowsLastRunInfo(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	now := time.Now()
	lastRun := &protocol.TaskRunInfo{
		TaskID:     "task-1",
		StartedAt:  now.Format(time.RFC3339),
		DurationMs: 5000,
		Success:    true,
	}

	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
			LastRun:  lastRun,
			RunCount: 3,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "OK") {
		t.Error("expected view to show 'OK' for successful run")
	}

	if !contains(view.Content, "5.0s") {
		t.Error("expected view to show duration '5.0s'")
	}
}

func TestSchedulesModel_View_ShowsLastRunFailed(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	now := time.Now()
	lastRun := &protocol.TaskRunInfo{
		TaskID:     "task-1",
		StartedAt:  now.Format(time.RFC3339),
		DurationMs: 2000,
		Success:    false,
	}

	model.tasks = []protocol.TaskStateInfo{
		{
			ID:       "task-1",
			Name:     "Task 1",
			Schedule: "0 9 * * *",
			Enabled:  true,
			LastRun:  lastRun,
		},
	}
	model.cursor = 0

	view := model.View()

	if !contains(view.Content, "FAIL") {
		t.Error("expected view to show 'FAIL' for failed run")
	}
}

func TestSchedulesModel_View_Empty(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.tasks = []protocol.TaskStateInfo{}

	view := model.View()

	if !contains(view.Content, "(No scheduled tasks)") {
		t.Error("expected view to show '(No scheduled tasks)' when empty")
	}
}

func TestSchedulesModel_View_ShowsErrorMessage(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)
	model.errorMsg = "failed to load tasks"
	model.tasks = []protocol.TaskStateInfo{}

	view := model.View()

	if !contains(view.Content, "failed to load tasks") {
		t.Error("expected view to contain error message")
	}
}

func TestSchedulesModel_WindowSizeMsg(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	msg := tea.WindowSizeMsg{Width: 120, Height: 40}
	_, _ = model.Update(msg)

	if model.width != 120 {
		t.Errorf("expected width to be 120, got %d", model.width)
	}

	if model.height != 40 {
		t.Errorf("expected height to be 40, got %d", model.height)
	}
}

func TestSchedulesModel_SchedulesErrorMsg(t *testing.T) {
	client := newSchedulesClient()
	model := NewSchedulesModel(client)

	msg := schedulesErrorMsg{err: fmt.Errorf("connection failed")}
	_, _ = model.Update(msg)

	if model.errorMsg != "connection failed" {
		t.Errorf("expected error message to be 'connection failed', got %q", model.errorMsg)
	}
}
