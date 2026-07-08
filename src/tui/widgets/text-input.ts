// pattern: Imperative Shell — cursor-aware text input widget
// Replaces blessed.textarea which lacks cursor movement support

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette } from '../theme.ts';

export type TextInputOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
  readonly bottom: number;
  readonly left: number;
  readonly width: string | number;
  readonly height: number;
  readonly fg?: string;
};

export type TextInput = {
  readonly element: Widgets.BoxElement;
  getValue(): string;
  setValue(value: string): void;
  clearValue(): void;
  focus(): void;
  key(keys: string[], handler: () => void): void;
  destroy(): void;
};

export function createTextInput(options: TextInputOptions): TextInput {
  const { parent, bottom, left, width, height, fg = palette.text } = options;

  const element = blessed.box({
    parent,
    bottom,
    left,
    width,
    height,
    tags: true,
    mouse: true,
    keyable: true,
    style: { fg, bg: -1 },
  }) as Widgets.BoxElement;

  let value = '';
  let cursor = 0;
  const customHandlers: Array<{ keys: string[]; handler: () => void }> = [];

  function escape(text: string): string {
    return text.replace(/\{/g, '{open}').replace(/\}/g, '{close}');
  }

  function render(): void {
    const before = escape(value.slice(0, cursor));
    const cursorChar = escape(value[cursor] ?? ' ');
    const after = escape(value.slice(cursor + 1));
    element.setContent(before + '{inverse}' + cursorChar + '{/inverse}' + after);
    const scr = element.screen;
    if (scr) scr.render();
  }

  element.on('focus', () => {
    render();
  });

  element.on('keypress', (ch: string | null, key: { name: string; full: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
    // Check custom handlers first
    for (const binding of customHandlers) {
      if (binding.keys.includes(key.full) || binding.keys.includes(key.name)) {
        binding.handler();
        return;
      }
    }

    if (key.name === 'left') {
      if (cursor > 0) cursor--;
      render();
      return;
    }

    if (key.name === 'right') {
      if (cursor < value.length) cursor++;
      render();
      return;
    }

    if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      cursor = 0;
      render();
      return;
    }

    if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      cursor = value.length;
      render();
      return;
    }

    if (key.name === 'backspace') {
      if (cursor > 0) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor--;
      }
      render();
      return;
    }

    if (key.name === 'delete') {
      if (cursor < value.length) {
        value = value.slice(0, cursor) + value.slice(cursor + 1);
      }
      render();
      return;
    }

    // Ctrl+U: clear line
    if (key.ctrl && key.name === 'u') {
      value = '';
      cursor = 0;
      render();
      return;
    }

    // Ctrl+K: kill to end of line
    if (key.ctrl && key.name === 'k') {
      value = value.slice(0, cursor);
      render();
      return;
    }

    // Ctrl+W: delete word backward
    if (key.ctrl && key.name === 'w') {
      let i = cursor - 1;
      while (i >= 0 && value[i] === ' ') i--;
      while (i >= 0 && value[i] !== ' ') i--;
      value = value.slice(0, i + 1) + value.slice(cursor);
      cursor = i + 1;
      render();
      return;
    }

    // Ignore control characters and special keys
    if (!ch || /^[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]$/.test(ch)) {
      return;
    }

    // Insert printable character at cursor
    value = value.slice(0, cursor) + ch + value.slice(cursor);
    cursor++;
    render();
  });

  return {
    element,

    getValue(): string {
      return value;
    },

    setValue(newValue: string): void {
      value = newValue;
      cursor = Math.min(cursor, value.length);
      render();
    },

    clearValue(): void {
      value = '';
      cursor = 0;
      render();
    },

    focus(): void {
      element.focus();
    },

    key(keys: string[], handler: () => void): void {
      customHandlers.push({ keys, handler });
    },

    destroy(): void {
      element.destroy();
    },
  };
}
