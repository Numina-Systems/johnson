// pattern: Imperative Shell — blessed tab bar widget
// Creates and manages a horizontally-rendered tab bar with activity indicators

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from './theme';

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
        return `{bold}{#${blessedStyles.tabActive.fg}-fg}{#${blessedStyles.tabActive.bg}-bg} ${displayLabel} {/}`;
      } else {
        // Inactive tab: use tabInactive style (dim fg, no bg)
        return `{#${blessedStyles.tabInactive.fg}-fg} ${displayLabel} {/}`;
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
  element.on('click', (_data: any) => {
    // Compute tab positions based on rendered content
    // This is a simplified approximation: count chars to find clicked tab
    const content = renderTabs();
    const cleanContent = content.replace(/{[^}]+}/g, ''); // Strip tags

    // Estimate tab widths and positions
    let charPos = 0;
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const hasActivity = activityMap.get(label) || false;
      const displayLabel = hasActivity ? `${label}*` : label;
      const tabWidth = displayLabel.length + 2; // +2 for padding

      if (_data.x >= charPos && _data.x < charPos + tabWidth) {
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
