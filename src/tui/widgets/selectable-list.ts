// pattern: Imperative Shell — blessed selectable list widget
// Wraps blessed.list with consistent styling and event handling
// Supports keyboard navigation (arrows, Enter) and mouse interaction

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';

export type SelectableListOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
  readonly top: string | number;
  readonly left: string | number;
  readonly width: string | number;
  readonly height: string | number;
  readonly label?: string;
};

export type SelectableList = {
  readonly element: Widgets.ListElement;
  setItems(items: ReadonlyArray<string>): void;
  getSelectedIndex(): number;
  getSelectedItem(): string | null;
  focus(): void;
  on(event: 'select', listener: (index: number) => void): void;
  on(event: 'highlight', listener: (index: number) => void): void;
  destroy(): void;
};

type SelectListeners = {
  select: Array<(index: number) => void>;
  highlight: Array<(index: number) => void>;
};

export function createSelectableList(options: SelectableListOptions): SelectableList {
  const { parent, top, left, width, height, label } = options;

  // Store listeners for custom events — allow multiple listeners per event
  const listeners: SelectListeners = {
    select: [],
    highlight: [],
  };

  // Create the blessed list element
  const element = blessed.list({
    parent,
    top,
    left,
    width,
    height,
    keys: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: palette.surface1,
      },
    },
    tags: true,
    style: {
      selected: blessedStyles.selected,
      item: blessedStyles.text,
      border: blessedStyles.border,
    },
    border: 'line',
    label,
  }) as Widgets.ListElement;

  // Bind blessed list events to custom wrapper events
  element.on('select', (_item: Widgets.BoxElement, index: number) => {
    for (const listener of listeners.select) {
      listener(index);
    }
  });

  element.on('select item', (_item: Widgets.BlessedElement, index: number) => {
    for (const listener of listeners.highlight) {
      listener(index);
    }
  });

  return {
    element,

    setItems(items: ReadonlyArray<string>): void {
      element.setItems(items as string[]);
      const screen = element.screen;
      if (screen) {
        screen.render();
      }
    },

    getSelectedIndex(): number {
      // Use nullish coalescing to preserve 0 as a valid index
      return (element as any).selected ?? 0;
    },

    getSelectedItem(): string | null {
      const index = (element as any).selected ?? 0;
      const items = (element as any).items || [];
      if (index >= 0 && index < items.length) {
        const item = items[index];
        // blessed stores items as objects with content; extract the text
        if (typeof item === 'string') {
          return item;
        } else if (item && typeof item === 'object') {
          return (item as any).content || (item as any).text || String(item);
        }
      }
      return null;
    },

    focus(): void {
      element.focus();
    },

    on(event: 'select' | 'highlight', listener: (index: number) => void): void {
      listeners[event].push(listener);
    },

    destroy(): void {
      element.destroy();
    },
  };
}
