// pattern: Imperative Shell — schedules view with task listing and enabled toggle

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { TaskStore, TaskState } from '../../scheduler/types.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette } from '../theme.ts';
import { formatDate } from '../util.ts';

// pattern: Functional Core — format a task for display
export function formatTaskLine(task: TaskState, now?: Date, pal: typeof palette = palette): string {
  // Enabled status icon
  const icon = task.enabled ? `{${pal.green}-fg}●{/}` : `{${pal.overlay0}-fg}○{/}`;

  // Task name
  const name = task.name;

  // Schedule expression
  const schedule = task.schedule;

  // Run count
  const runCount = `(${task.runCount} run${task.runCount === 1 ? '' : 's'})`;

  // Last run status
  let lastRunInfo = 'Never run';
  if (task.lastRun) {
    const status = task.lastRun.success ? 'OK' : 'FAIL';
    const durationSec = (task.lastRun.durationMs / 1000).toFixed(1);
    const timestamp = formatDate(task.lastRun.startedAt, now);
    lastRunInfo = `${timestamp} ${status} (${durationSec}s)`;
  }

  return `${icon} ${name}  {dim}${schedule}{/}  ${runCount}  {${pal.overlay1}-fg}${lastRunInfo}{/}`;
}

type SchedulesViewOptions = {
  readonly screen: Widgets.Screen;
  readonly scheduler?: TaskStore;
};

export function createSchedulesView(options: SchedulesViewOptions): ScreenView {
  const { screen, scheduler } = options;

  // Main container
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    bottom: 0,
    hidden: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // SelectableList for displaying tasks
  const list = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Scheduled Tasks',
  });

  // Status bar
  const statusBar = createStatusBar({ parent: container });

  // Helper: refresh the list
  function refreshList(): void {
    const tasks = scheduler?.list() ?? [];
    if (tasks.length === 0) {
      list.setItems(['{dim}No scheduled tasks{/}']);
    } else {
      const items = tasks.map((task) => formatTaskLine(task));
      list.setItems(items);
    }
  }

  // Helper: update status bar
  function updateStatusBar(): void {
    statusBar.setText('e:toggle enabled  Esc:back');
  }

  // Handle 'e' to toggle enabled
  container.key(['e'], () => {
    const index = list.getSelectedIndex();
    const tasks = scheduler?.list() ?? [];
    const task = tasks[index];
    if (task) {
      scheduler?.setEnabled(task.id, !task.enabled);
      refreshList();
    }
  });

  // Initial setup
  refreshList();
  updateStatusBar();

  return {
    name: 'Schedules',
    container,
    get isCapturingInput(): boolean {
      return false;
    },
    show(): void {
      container.show();
      screen.render();
    },
    hide(): void {
      container.hide();
      screen.render();
    },
    focus(): void {
      list.focus();
    },
    destroy(): void {
      container.destroy();
    },
  };
}
