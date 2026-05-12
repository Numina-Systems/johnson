// pattern: Imperative Shell — blessed scrollable viewer widget
// Wraps blessed.box with scrollable content, keyboard navigation, and auto-scroll detection

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';
import { isAtBottom } from './scroll-utils.ts';

export type ScrollableViewerOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
  readonly top: string | number;
  readonly left: string | number;
  readonly width: string | number;
  readonly height: string | number;
  readonly label?: string;
  readonly alwaysScroll?: boolean;
};

export type ScrollableViewer = {
  readonly element: Widgets.BoxElement;
  setContent(content: string): void;
  appendContent(content: string): void;
  scrollToBottom(): void;
  scrollToTop(): void;
  isScrolledToBottom(): boolean;
  getScroll(): number;
  focus(): void;
  destroy(): void;
};

export function createScrollableViewer(options: ScrollableViewerOptions): ScrollableViewer {
  const { parent, top, left, width, height, label, alwaysScroll = true } = options;

  // Create the blessed box element
  const element = blessed.box({
    parent,
    top,
    left,
    width,
    height,
    scrollable: true,
    alwaysScroll,
    keys: true,
    mouse: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: palette.surface1,
      },
    },
    tags: true,
    style: {
      fg: blessedStyles.text.fg,
      bg: palette.base,
      border: blessedStyles.border,
    },
    border: 'line',
    label,
  }) as Widgets.BoxElement;

  // Bind keyboard navigation for page up/down and jump to top/bottom
  element.key(['pageup'], () => {
    // blessed.Box has `height` property; blessed provides scroll() method
    const height = (element.height as number) || 10;
    element.scroll(-height);
    const screen = element.screen;
    if (screen) {
      screen.render();
    }
  });

  element.key(['pagedown'], () => {
    const height = (element.height as number) || 10;
    element.scroll(height);
    const screen = element.screen;
    if (screen) {
      screen.render();
    }
  });

  element.key(['g'], () => {
    // Jump to top (only when not in text input mode)
    scrollToTopImpl();
  });

  element.key(['S-g'], () => {
    // Jump to bottom (shift+g)
    scrollToBottomImpl();
  });

  function scrollToTopImpl(): void {
    // blessed.Box provides setScroll method via scrollable interface
    (element as any).setScroll(0);
    const screen = element.screen;
    if (screen) {
      screen.render();
    }
  }

  function scrollToBottomImpl(): void {
    const scrollHeight = element.getScrollHeight();
    const elementHeight = (element.height as number) || 10;
    (element as any).setScroll(Math.max(0, scrollHeight - elementHeight));
    const screen = element.screen;
    if (screen) {
      screen.render();
    }
  }

  function getScrollImpl(): number {
    // childBase is the blessed-internal scroll position property
    return (element as any).childBase || 0;
  }

  function isScrolledToBottomImpl(): boolean {
    const scrollHeight = element.getScrollHeight();
    const elementHeight = (element.height as number) || 10;
    const scrollPos = getScrollImpl();
    return isAtBottom(scrollPos, scrollHeight, elementHeight);
  }

  return {
    element,

    setContent(content: string): void {
      element.setContent(content);
      const screen = (element as any).screen;
      if (screen) {
        screen.render();
      }
    },

    appendContent(content: string): void {
      // Check if we're at bottom before append
      const wasAtBottom = isScrolledToBottomImpl();

      // Append content
      const currentContent = element.getContent() || '';
      element.setContent(currentContent + content);

      // Auto-scroll to bottom if we were at bottom before
      if (wasAtBottom) {
        scrollToBottomImpl();
      }

      const screen = (element as any).screen;
      if (screen) {
        screen.render();
      }
    },

    scrollToBottom(): void {
      scrollToBottomImpl();
    },

    scrollToTop(): void {
      scrollToTopImpl();
    },

    isScrolledToBottom(): boolean {
      return isScrolledToBottomImpl();
    },

    getScroll(): number {
      return getScrollImpl();
    },

    focus(): void {
      element.focus();
    },

    destroy(): void {
      element.destroy();
    },
  };
}
