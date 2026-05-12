// pattern: Imperative Shell — neo-blessed screen entry point
// Replaces Ink-based React rendering with neo-blessed screen initialization

import { EventEmitter } from 'events';
import blessed from 'neo-blessed';
import type { TuiDependencies, ScreenView } from './types.ts';
import { createTabBar } from './tab-bar.ts';
import { palette } from './theme.ts';
import { createSessionsView } from './views/sessions.ts';

export type { TuiDependencies };

/**
 * Initialize and render the blessed-based TUI application.
 * Call this from the imperative shell (src/index.ts).
 */
export function startTUI(deps: TuiDependencies): void {
  // Create blessed screen with Catppuccin Macchiato styling
  const screen = blessed.screen({
    smartCSR: true,
    title: 'constellation',
    mouse: true,
    style: {
      bg: palette.base,
    },
  });

  // Typed event bus for cross-view communication
  const bus = new EventEmitter();

  // Define tab labels (7 tabs in order)
  const tabLabels = ['Sessions', 'Chat', 'Tools', 'Secrets', 'Schedules', 'Prompt', 'Prune'] as const;
  let activeTabIndex = 0;

  // Create the Sessions view (real implementation)
  const sessionsView = createSessionsView({
    screen,
    store: deps.store,
    bus,
    onSelectSession(sessionId: string): void {
      // Emit event for other views, then switch to Chat tab (index 1)
      bus.emit('session:selected', { sessionId });
      switchTab(1);
    },
    onNewSession(): void {
      // Emit event to trigger session list refresh
      bus.emit('session:changed');
    },
  });

  // Placeholder views for future tabs (Phase 4+)
  function createPlaceholderView(tabName: string): ScreenView {
    const container = blessed.box({
      parent: screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 0,
      hidden: true,
      tags: true,
      style: {
        bg: palette.base,
        fg: palette.text,
      },
    });

    container.setContent(`Coming soon: {bold}${tabName}{/}`);

    return {
      name: tabName,
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
        container.focus();
      },
      destroy(): void {
        container.destroy();
      },
    };
  }

  // Set up views array: index corresponds to tab index
  const views: Array<ScreenView> = [
    sessionsView, // 0: Sessions
    createPlaceholderView('Chat'), // 1: Chat (Phase 4)
    createPlaceholderView('Tools'), // 2: Tools (Phase 5)
    createPlaceholderView('Secrets'), // 3: Secrets (Phase 5)
    createPlaceholderView('Schedules'), // 4: Schedules (Phase 5)
    createPlaceholderView('Prompt'), // 5: Prompt (Phase 6)
    createPlaceholderView('Prune'), // 6: Prune (Phase 6)
  ];

  function switchTab(newIndex: number): void {
    if (newIndex < 0 || newIndex >= views.length) return;

    // Hide current view
    const currentView = views[activeTabIndex];
    if (currentView) {
      currentView.hide();
    }

    // Switch index and show new view
    activeTabIndex = newIndex;
    const newView = views[activeTabIndex];
    if (newView) {
      newView.show();
      newView.focus();
    }

    // Update tab bar
    tabBar.setActive(newIndex);
  }

  // Create tab bar
  const tabBar = createTabBar({
    screen,
    labels: Array.from(tabLabels),
    onSwitch: switchTab,
  });

  // Initial view setup: show Sessions, hide others
  for (let i = 0; i < views.length; i++) {
    if (i === 0) {
      views[i]?.show();
      views[i]?.focus();
    } else {
      views[i]?.hide();
    }
  }
  tabBar.setActive(0);

  // Screen-level key bindings
  screen.key(['tab'], () => {
    // Cycle to next tab (with wrapping)
    const nextIndex = (activeTabIndex + 1) % tabLabels.length;
    switchTab(nextIndex);
  });

  screen.key(['S-tab'], () => {
    // Cycle to previous tab (with wrapping)
    const prevIndex = (activeTabIndex - 1 + tabLabels.length) % tabLabels.length;
    switchTab(prevIndex);
  });

  screen.key(['escape'], () => {
    // Switch to Sessions tab (index 0)
    switchTab(0);
  });

  screen.key(['q'], () => {
    // Quit cleanly (only when not capturing input in any view)
    const currentView = views[activeTabIndex];
    if (currentView && currentView.isCapturingInput) {
      return; // Don't quit if a view is capturing input (e.g., confirmation dialog)
    }
    // Clean up all views
    for (const view of views) {
      view?.destroy();
    }
    screen.destroy();
    process.exit(0);
  });

  screen.key(['C-c'], () => {
    // Always quit on Ctrl+C (universally expected)
    for (const view of views) {
      view?.destroy();
    }
    screen.destroy();
    process.exit(0);
  });

  // Final render
  screen.render();
}
