// pattern: Imperative Shell — blessed tab bar widget
// Creates and manages a horizontally-rendered tab bar with activity indicators

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from './theme.ts';

// pattern: Functional Core — pure tab navigation utilities
/**
 * Calculate the next tab index, wrapping at the end.
 */
export function nextTab(current: number, total: number): number {
  return (current + 1) % total;
}

/**
 * Calculate the previous tab index, wrapping at the beginning.
 */
export function prevTab(current: number, total: number): number {
  return (current - 1 + total) % total;
}

function hexTag(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}

type TabBarOptions = {
  readonly screen: Widgets.Screen;
  readonly labels: ReadonlyArray<string>;
  readonly onSwitch: (index: number) => void;
};

export type TabBar = {
  readonly element: Widgets.BoxElement;
  setActive(index: number): void;
  setActivity(tabName: string, hasActivity: boolean): void;
  destroy(): void;
};

type ClickData = {
  readonly x: number;
  readonly y: number;
};

export function createTabBar(options: TabBarOptions): TabBar {
  const { screen, labels, onSwitch } = options;

  // Track state: which tab is active, which have activity indicators
  let activeIndex = 0;
  const activityMap = new Map<string, boolean>();
  labels.forEach(label => activityMap.set(label, false));

  // Create the tab bar box at top of screen
  const element = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: {
      bg: palette.mantle,
    },
    tags: true,
  }) as Widgets.BoxElement;

  function renderTabs(): string {
    const tabStrings = labels.map((label, i) => {
      const isActive = i === activeIndex;
      const hasActivity = activityMap.get(label) || false;
      const displayLabel = hasActivity ? `${label}*` : label;

      if (isActive) {
        // Active tab: use tabActive style (mauve bg, dark fg, bold)
        return `{bold}{#${hexTag(blessedStyles.tabActive.fg)}-fg}{#${hexTag(blessedStyles.tabActive.bg!)}-bg} ${displayLabel} {/}`;
      } else {
        // Inactive tab: use tabInactive style (dim fg, no bg)
        return `{#${hexTag(blessedStyles.tabInactive.fg)}-fg} ${displayLabel} {/}`;
      }
    });

    return tabStrings.join(' | ');
  }

  function updateRender(): void {
    element.setContent(renderTabs());
    screen.render();
  }

  // Initial render
  updateRender();

  // Mouse click support: click on tab to switch
  element.on('click', (data: ClickData) => {
    // Estimate tab widths and positions
    let charPos = 0;
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (!label) continue;
      const hasActivity = activityMap.get(label) || false;
      const displayLabel = hasActivity ? `${label}*` : label;
      const tabWidth = displayLabel.length + 2; // +2 for padding

      if (data.x >= charPos && data.x < charPos + tabWidth) {
        onSwitch(i);
        return;
      }

      charPos += tabWidth + 3; // +3 for " | " separator
    }
  });

  return {
    element,
    setActive(index: number): void {
      if (index >= 0 && index < labels.length) {
        activeIndex = index;
        updateRender();
      }
    },
    setActivity(tabName: string, hasActivity: boolean): void {
      if (activityMap.has(tabName)) {
        activityMap.set(tabName, hasActivity);
        updateRender();
      }
    },
    destroy(): void {
      element.destroy();
    },
  };
}
