// pattern: Imperative Shell — blessed status bar widget
// Simple bottom-pinned status line with themed styling

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';

export type StatusBarOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
};

export type StatusBar = {
  readonly element: Widgets.BoxElement;
  setText(text: string): void;
  destroy(): void;
};

export function createStatusBar(options: StatusBarOptions): StatusBar {
  const { parent } = options;

  const element = blessed.box({
    parent,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      fg: blessedStyles.subtext.fg,
      bg: palette.mantle,
    },
  }) as Widgets.BoxElement;

  return {
    element,

    setText(text: string): void {
      element.setContent(text);
      const screen = (element as any).screen;
      if (screen) {
        screen.render();
      }
    },

    destroy(): void {
      element.destroy();
    },
  };
}
