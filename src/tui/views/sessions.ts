// pattern: Imperative Shell — sessions view with list, create, delete, select
// Provides the Sessions tab: list sessions, create new, delete with confirmation

import { EventEmitter } from 'events';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SessionWithCounts } from '../../sessions/types.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette } from '../theme.ts';
import { formatDate } from '../util.ts';

export type SessionsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
  readonly bus: EventEmitter;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
};

// pattern: Functional Core — pure formatting function
/**
 * Format a SessionWithCounts into a blessed-tagged string for display.
 * Shows title (bold), message count, and relative timestamp.
 */
export function formatSessionLine(session: SessionWithCounts, now?: Date): string {
  const title = session.title ?? 'Untitled session';
  const count = `(${session.messageCount} msgs)`;
  const date = session.lastMessageAt ? formatDate(session.lastMessageAt, now) : formatDate(session.createdAt, now);
  return `{bold}${title}{/bold}  ${count}  {${palette.overlay0}-fg}${date}{/}`;
}

export function createSessionsView(options: SessionsViewOptions): ScreenView {
  const { screen, store, bus, onSelectSession } = options;

  // Main container for the view
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    bottom: 0,
    hidden: false,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // Header showing "Sessions" title
  const header = blessed.box({
    parent: container,
    top: 0,
    height: 1,
    left: 0,
    width: '100%',
    content: '{bold}Sessions{/bold}',
    tags: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // SelectableList for displaying sessions
  const list = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Sessions',
  });

  // Status bar at the bottom
  const statusBar = createStatusBar({ parent: container });
  statusBar.setText('n:new  d:delete  Enter:open  q:quit');

  // Internal state
  let sessions: Array<SessionWithCounts> = [];
  let isCapturingInput = false;

  /**
   * Refresh the session list from the store.
   */
  function refresh(): void {
    sessions = store.listSessionsWithCounts(50);
    if (sessions.length === 0) {
      list.setItems(['{dim}No sessions. Press n to create one.{/}']);
    } else {
      const now = new Date();
      const formatted = sessions.map((session) => formatSessionLine(session, now));
      list.setItems(formatted);
    }
    screen.render();
  }

  /**
   * Handle 'n' key: create new session.
   */
  function handleNewSession(): void {
    const sessionId = crypto.randomUUID();
    store.createSession(sessionId);
    options.onNewSession();
  }

  /**
   * Handle 'd' key: delete selected session with confirmation.
   */
  function handleDeleteSession(): void {
    const selectedIndex = list.getSelectedIndex();
    if (selectedIndex < 0 || selectedIndex >= sessions.length) {
      return;
    }

    const session = sessions[selectedIndex];
    if (!session) return;

    isCapturingInput = true;

    // Create a simple confirmation question
    screen.question(
      `Delete "${session.title ?? 'Untitled'}"`
      + ` (${session.messageCount} msgs)? (y/n): `,
      (_err: Error | null, answer: string) => {
        isCapturingInput = false;
        if (answer && answer.toLowerCase() === 'y') {
          store.deleteSession(session.id);
          bus.emit('session:changed');
          refresh();
        } else {
          // Return focus to list after dialog
          list.focus();
          screen.render();
        }
      },
    );
  }

  /**
   * Handle Enter key: select session and invoke callback.
   */
  function handleSelectSession(): void {
    const selectedIndex = list.getSelectedIndex();
    if (selectedIndex < 0 || selectedIndex >= sessions.length) {
      return;
    }

    const session = sessions[selectedIndex];
    if (session) {
      onSelectSession(session.id);
    }
  }

  // Key bindings on the list element
  list.on('select', handleSelectSession);

  list.element.key(['n'], handleNewSession);
  list.element.key(['d'], handleDeleteSession);

  // Listen on bus for session changes to auto-refresh
  bus.on('session:changed', refresh);

  // Initial load
  refresh();

  return {
    name: 'Sessions',
    container,

    get isCapturingInput(): boolean {
      return isCapturingInput;
    },

    show(): void {
      container.show();
      refresh();
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
      // Clean up event listeners
      bus.off('session:changed', refresh);
      list.destroy();
      statusBar.destroy();
      header.destroy();
      container.destroy();
    },
  };
}
