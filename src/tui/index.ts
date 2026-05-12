// pattern: Imperative Shell — neo-blessed screen entry point
// Replaces Ink-based React rendering with neo-blessed screen initialization

import blessed from 'neo-blessed';
import { EventEmitter } from 'events';
import type { TuiDependencies, TuiEvents } from './types.ts';
import { createTabBar } from './tab-bar.ts';
import { palette } from './theme.ts';

export type { TuiDependencies };

/**
 * Initialize and render the blessed-based TUI application.
 * Call this from the imperative shell (src/index.ts).
 */
export function startTUI(_deps: TuiDependencies): void {
  // Create blessed screen with Catppuccin Macchiato styling
  const screen = blessed.screen({
    smartCSR: true,
    title: 'constellation',
    mouse: true,
    style: {
      bg: palette.base,
    },
  });

  // Define tab labels (7 tabs in order)
  const tabLabels = ['Sessions', 'Chat', 'Tools', 'Secrets', 'Schedules', 'Prompt', 'Prune'] as const;
  let activeTabIndex = 0;

  // Create placeholder content box below tab bar
  const contentBox = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '100%-1',
    style: {
      bg: palette.base,
      fg: palette.text,
    },
    tags: true,
  });

  function updateContent(): void {
    const tabName = tabLabels[activeTabIndex];
    contentBox.setContent(`Screen: {bold}${tabName}{/}`);
    screen.render();
  }

  // Create tab bar
  const tabBar = createTabBar({
    screen,
    labels: Array.from(tabLabels),
    onSwitch: (index: number) => {
      activeTabIndex = index;
      tabBar.setActive(index);
      updateContent();
    },
  });

  // Initial content render
  updateContent();

  // Screen-level key bindings
  screen.key(['tab'], () => {
    // Cycle to next tab (with wrapping)
    activeTabIndex = (activeTabIndex + 1) % tabLabels.length;
    tabBar.setActive(activeTabIndex);
    updateContent();
  });

  screen.key(['S-tab'], () => {
    // Cycle to previous tab (with wrapping)
    activeTabIndex = (activeTabIndex - 1 + tabLabels.length) % tabLabels.length;
    tabBar.setActive(activeTabIndex);
    updateContent();
  });

  screen.key(['escape'], () => {
    // Switch to Sessions tab (index 0)
    activeTabIndex = 0;
    tabBar.setActive(activeTabIndex);
    updateContent();
  });

  screen.key(['q'], () => {
    // Quit cleanly (only when not capturing input)
    // For Phase 1, no views capture input, so always quit
    screen.destroy();
    process.exit(0);
  });

  screen.key(['C-c'], () => {
    // Always quit on Ctrl+C (universally expected)
    screen.destroy();
    process.exit(0);
  });

  // Final render
  screen.render();
}
