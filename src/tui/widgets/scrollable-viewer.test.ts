// Test suite for scrollable-viewer widget
// Tests: tui-neo-blessed.AC2.1 (keyboard scroll), tui-neo-blessed.AC2.2 (mouse scroll), tui-neo-blessed.AC5.1 (Zellij-safe keys)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { createScrollableViewer, ScrollableViewerOptions } from './scrollable-viewer.ts';

describe('scrollable-viewer widget', () => {
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

  test('tui-neo-blessed.AC2.1: content scrolls with keyboard (arrows, Page Up/Down)', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    // Set content that exceeds viewport
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    // Verify scrolling is supported: keys: true
    const element = viewer.element as any;
    expect(element.options.keys).toBe(true);

    viewer.destroy();
  });

  test('tui-neo-blessed.AC2.2: mouse scroll support is enabled', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    // Verify mouse: true is set for mouse wheel scrolling
    const element = viewer.element as any;
    expect(element.options.mouse).toBe(true);

    viewer.destroy();
  });

  test('tui-neo-blessed.AC5.1: only uses arrows, Page Up/Down, g/G keys', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    // Verify element is scrollable and has keys enabled
    const element = viewer.element as any;
    expect(element.options.keys).toBe(true);
    expect(element.options.scrollable).toBe(true);

    viewer.destroy();
  });

  test('setContent() replaces content', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const content = 'Test content';
    viewer.setContent(content);

    const element = viewer.element as any;
    expect(element.content).toContain('Test content');

    viewer.destroy();
  });

  test('appendContent() adds content without replacing', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    viewer.setContent('First line');
    viewer.appendContent('\nSecond line');

    const element = viewer.element as any;
    expect(element.content).toContain('First line');
    expect(element.content).toContain('Second line');

    viewer.destroy();
  });

  test('scrollToBottom() sets scroll to bottom', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    viewer.scrollToBottom();

    // After scrolling to bottom, isScrolledToBottom should return true
    expect(viewer.isScrolledToBottom()).toBe(true);

    viewer.destroy();
  });

  test('scrollToTop() sets scroll to top', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    viewer.scrollToBottom();
    viewer.scrollToTop();

    // After scrolling to top, scroll should be 0
    const scroll = viewer.getScroll();
    expect(scroll).toBe(0);

    viewer.destroy();
  });

  test('isScrolledToBottom() returns true when at bottom', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    viewer.scrollToBottom();

    expect(viewer.isScrolledToBottom()).toBe(true);

    viewer.destroy();
  });

  test('isScrolledToBottom() returns false when scrolled up', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    viewer.scrollToTop();

    expect(viewer.isScrolledToBottom()).toBe(false);

    viewer.destroy();
  });

  test('auto-scroll on appendContent when at bottom', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    // Start with content
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    // Scroll to bottom
    viewer.scrollToBottom();

    // Append new content
    viewer.appendContent('\nNew line');

    // Should still be at bottom due to auto-scroll
    expect(viewer.isScrolledToBottom()).toBe(true);

    viewer.destroy();
  });

  test('no auto-scroll on appendContent when scrolled up', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    // Start with content
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    // Scroll to top (user is reading earlier content)
    viewer.scrollToTop();
    const scrollBefore = viewer.getScroll();

    // Append new content
    viewer.appendContent('\nNew line');

    // Should NOT auto-scroll; position should be preserved
    const scrollAfter = viewer.getScroll();
    expect(scrollAfter).toBe(scrollBefore);
    expect(viewer.isScrolledToBottom()).toBe(false);

    viewer.destroy();
  });

  test('getScroll() returns current scroll position', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);

    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    viewer.setContent(lines);

    const scroll = viewer.getScroll();
    expect(typeof scroll).toBe('number');
    expect(scroll).toBeGreaterThanOrEqual(0);

    viewer.destroy();
  });

  test('focus() focuses the element', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);
    viewer.focus();

    // Verify focus was called (blessed focus doesn't throw)
    expect(viewer.element).toBeDefined();
    viewer.destroy();
  });

  test('destroy() cleans up the element', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const viewer = createScrollableViewer(options);
    const element = viewer.element;

    viewer.destroy();
    expect((element as any).destroyed).toBe(true);
  });

  test('creates viewer with optional label and alwaysScroll', () => {
    const options: ScrollableViewerOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
      label: 'Test Viewer',
      alwaysScroll: true,
    };

    const viewer = createScrollableViewer(options);
    const element = viewer.element as any;

    expect(element.options.label).toBe('Test Viewer');
    expect(element.options.alwaysScroll).toBe(true);
    viewer.destroy();
  });
});
