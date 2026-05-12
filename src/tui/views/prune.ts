// pattern: Imperative Shell — prune view with session selection, classification, and archive/delete

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SessionWithCounts } from '../../sessions/types.ts';
import { classifySession } from '../../sessions/archive.ts';
import type { SessionClassification } from '../../sessions/types.ts';
import { archiveSession } from '../../sessions/archiver.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette } from '../theme.ts';
import { formatDate } from '../util.ts';

export type PruneViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
};

type EnrichedSession = SessionWithCounts & {
  readonly classification: SessionClassification;
};

type PruneMode = 'select' | 'confirm' | 'executing';

// pattern: Functional Core — pure formatting function
export function formatPruneLine(
  session: SessionWithCounts,
  classification: SessionClassification,
  selected: boolean,
): string {
  const checkbox = selected ? '[✓]' : '[ ]';
  const title = session.title ?? 'Untitled session';
  const count = `(${session.messageCount} msgs)`;
  const date = session.lastMessageAt ? formatDate(session.lastMessageAt) : formatDate(session.createdAt);

  const colorTag =
    classification === 'delete'
      ? '{red-fg}'
      : classification === 'archive'
        ? '{peach-fg}'
        : '{green-fg}';

  const classText = `${colorTag}${classification}{/}`;

  return `${checkbox} ${classText} ${title}  ${count}  ${date}`;
}

export function createPruneView(options: PruneViewOptions): ScreenView {
  const { screen, store } = options;

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

  // Header
  const header = blessed.box({
    parent: container,
    top: 0,
    height: 1,
    left: 0,
    width: '100%',
    content: '{bold}Prune Sessions{/bold}',
    tags: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // SelectableList for sessions
  const list = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
  });

  // Status bar
  const statusBar = createStatusBar({ parent: container });

  // Internal state
  let sessions: Array<EnrichedSession> = [];
  let selected = new Set<string>();
  let mode: PruneMode = 'select';
  let resultMsg: string | null = null;

  // Refresh sessions list
  function refresh(): void {
    const now = new Date();
    const raw = store.listSessionsWithCounts(200);
    sessions = raw.map((s) => ({
      ...s,
      classification: classifySession(s.messageCount, s.updatedAt, now),
    }));

    // Re-render list
    renderList();
  }

  // Render the list display
  function renderList(): void {
    const lines = sessions.map((s) => formatPruneLine(s, s.classification, selected.has(s.id)));
    list.setItems(lines);
  }

  // Update status bar based on mode
  function updateStatus(): void {
    if (mode === 'select') {
      statusBar.setText('Space:toggle  a:select stale  Enter:confirm  Esc:back');
    } else if (mode === 'confirm') {
      statusBar.setText('y:confirm  n:cancel');
    } else if (mode === 'executing') {
      statusBar.setText('Processing...');
    } else if (resultMsg) {
      statusBar.setText(resultMsg);
    }
  }

  // Handle Space key to toggle selection
  list.element.key(['space'], () => {
    if (mode !== 'select') return;

    const currentIndex = list.getCurrentIndex();
    if (currentIndex >= 0 && currentIndex < sessions.length) {
      const sessionId = sessions[currentIndex]!.id;
      if (selected.has(sessionId)) {
        selected.delete(sessionId);
      } else {
        selected.add(sessionId);
      }
      renderList();
      screen.render();
    }
  });

  // Handle 'a' key to select all stale sessions
  list.element.key(['a'], () => {
    if (mode !== 'select') return;

    for (const s of sessions) {
      if (s.classification === 'delete' || s.classification === 'archive') {
        selected.add(s.id);
      }
    }
    renderList();
    screen.render();
  });

  // Handle Enter to switch to confirm mode
  list.element.key(['enter'], () => {
    if (mode !== 'select' || selected.size === 0) return;

    mode = 'confirm';
    showConfirmDialog();
  });

  // Show confirmation dialog
  function showConfirmDialog(): void {
    const deleteCount = Array.from(selected).filter((id) => {
      const s = sessions.find((x) => x.id === id);
      return !s || s.messageCount === 0;
    }).length;

    const archiveCount = Array.from(selected).length - deleteCount;

    const confirmBox = blessed.box({
      parent: container,
      top: 'center',
      left: 'center',
      width: 50,
      height: 9,
      border: 'line',
      style: {
        border: { fg: palette.overlay1 },
        bg: palette.surface0,
        fg: palette.text,
      },
      tags: true,
    });

    const message = `Prune ${selected.size} sessions?
  Delete: ${deleteCount} (empty, stale)
  Archive: ${archiveCount} (with messages)

[y] Confirm  [n] Cancel`;

    confirmBox.setContent(message);

    // Handle y/Enter to confirm
    const handleConfirm = (): void => {
      confirmBox.destroy();
      mode = 'executing';
      updateStatus();
      screen.render();
      executeArchiveDelete();
    };

    // Handle n/Escape to cancel
    const handleCancel = (): void => {
      confirmBox.destroy();
      mode = 'select';
      updateStatus();
      renderList();
      screen.render();
    };

    confirmBox.key(['y'], handleConfirm);
    confirmBox.key(['enter'], handleConfirm);
    confirmBox.key(['n'], handleCancel);
    confirmBox.key(['escape'], handleCancel);

    confirmBox.focus();
    screen.render();
  }

  // Execute archive/delete
  async function executeArchiveDelete(): Promise<void> {
    let archived = 0;
    let deleted = 0;
    const errors: Array<string> = [];

    for (const sessionId of selected) {
      try {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) continue;

        if (session.messageCount === 0) {
          // Direct delete for empty sessions
          store.deleteSession(sessionId);
          deleted++;
        } else {
          // Archive sessions with messages
          await archiveSession(sessionId, store);
          archived++;
        }
      } catch (error) {
        errors.push((error as Error).message);
      }
    }

    // Clear selection and update result message
    selected.clear();
    resultMsg = errors.length > 0
      ? `✗ Errors: ${errors.length}`
      : `✓ Archived ${archived}, deleted ${deleted}`;

    // Refresh list and return to select mode
    refresh();
    mode = 'select';
    updateStatus();
    screen.render();

    // Clear result after 3 seconds
    setTimeout(() => {
      resultMsg = null;
      updateStatus();
      screen.render();
    }, 3000);
  }

  return {
    name: 'Prune',
    container,
    get isCapturingInput(): boolean {
      return mode === 'confirm' || mode === 'executing';
    },
    show(): void {
      container.show();
      refresh();
      updateStatus();
      list.focus();
      screen.render();
    },
    hide(): void {
      container.hide();
      selected.clear();
      mode = 'select';
      resultMsg = null;
      screen.render();
    },
    focus(): void {
      list.focus();
    },
    destroy(): void {
      list.destroy();
      container.destroy();
    },
  };
}
