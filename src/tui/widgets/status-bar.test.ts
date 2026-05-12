// Test suite for status-bar widget
// Tests: status bar content setting and positioning

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { createStatusBar, StatusBarOptions } from './status-bar.ts';

describe('status-bar widget', () => {
  let screen: Widgets.Screen;

  beforeEach(() => {
    screen = blessed.screen({
      smartCSR: true,
      input: process.stdin,
      output: process.stdout,
    });
  });

  afterEach(() => {
    if (screen) {
      screen.destroy();
    }
  });

  test('setText() updates the element content', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);
    const testText = 'Test status message';

    statusBar.setText(testText);

    const content = statusBar.element.getContent();
    expect(content).toContain(testText);

    statusBar.destroy();
  });

  test('element is positioned at bottom with correct dimensions', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);
    const element = statusBar.element as any;

    expect(element.options.bottom).toBe(0);
    expect(element.options.left).toBe(0);
    expect(element.options.width).toBe('100%');
    expect(element.options.height).toBe(1);

    statusBar.destroy();
  });

  test('element uses correct styling from theme', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);
    const element = statusBar.element as any;

    // Verify theme styling is applied
    expect(element.options.style).toBeDefined();
    expect(element.options.style.fg).toBeDefined();
    expect(element.options.style.bg).toBeDefined();

    statusBar.destroy();
  });

  test('setText() with blessed tags renders styled content', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);
    const styledText = '{green-fg}Success{/} message';

    statusBar.setText(styledText);

    const content = statusBar.element.getContent();
    expect(content).toBeDefined();

    statusBar.destroy();
  });

  test('destroy() cleans up the element', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);
    const element = statusBar.element;

    statusBar.destroy();

    // After destroy, the element should be cleaned up
    expect((element as any).destroyed).toBe(true);
  });

  test('multiple setText() calls update content sequentially', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);

    statusBar.setText('First message');
    let content = statusBar.element.getContent();
    expect(content).toContain('First message');

    statusBar.setText('Second message');
    content = statusBar.element.getContent();
    expect(content).toContain('Second message');

    statusBar.destroy();
  });

  test('supports empty text', () => {
    const options: StatusBarOptions = {
      parent: screen,
    };

    const statusBar = createStatusBar(options);

    statusBar.setText('');
    const content = statusBar.element.getContent();
    expect(content).toBe('');

    statusBar.destroy();
  });
});
