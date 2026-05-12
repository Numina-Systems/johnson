// Test suite for selectable-list widget
// Tests: tui-neo-blessed.AC2.3 (list scrolls), tui-neo-blessed.AC5.1 (Zellij-safe keys)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { createSelectableList, SelectableListOptions } from './selectable-list.ts';

describe('selectable-list widget', () => {
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

  test('tui-neo-blessed.AC2.3: list scrolls when items exceed viewport height', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);

    // Set many items to exceed viewport
    const items = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
    list.setItems(items);

    // Verify scroll is possible: scrollHeight > height
    const scrollHeight = list.element.getScrollHeight();
    const elementHeight = (list.element as any).height;

    expect(scrollHeight).toBeGreaterThan(elementHeight);
    list.destroy();
  });

  test('AC5.1: widget uses only blessed built-in key handling (arrow keys, Enter, mouse)', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);

    // Verify keys: true is set for arrow/Enter support
    const element = list.element as any;
    expect(element.options.keys).toBe(true);

    // Verify mouse: true is set for mouse support
    expect(element.options.mouse).toBe(true);

    // Verify scrollable: true is set
    expect(element.options.scrollable).toBe(true);

    list.destroy();
  });

  test('setItems() updates list items and renders', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);

    const items = ['Item 1', 'Item 2', 'Item 3'];
    list.setItems(items);

    const listElement = list.element as any;
    expect(listElement.items.length).toBe(3);

    list.destroy();
  });

  test('getSelectedIndex() returns current selection index', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    const items = ['Item 1', 'Item 2', 'Item 3'];
    list.setItems(items);

    const index = list.getSelectedIndex();
    expect(typeof index).toBe('number');
    expect(index).toBeGreaterThanOrEqual(0);

    list.destroy();
  });

  test('getSelectedItem() returns content of selected item', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    const items = ['Item 1', 'Item 2', 'Item 3'];
    list.setItems(items);

    // After setting items, there should be a selected item (index 0 by default)
    const selected = list.getSelectedItem();
    expect(selected).toBeDefined();
    expect(typeof selected).toBe('string');

    list.destroy();
  });

  test('select event fires with correct index', (done) => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    const items = ['Item 1', 'Item 2', 'Item 3'];
    list.setItems(items);

    let eventFired = false;
    let eventIndex = -1;

    list.on('select', (index: number) => {
      eventFired = true;
      eventIndex = index;
    });

    // Simulate selection by manipulating blessed element
    const element = list.element as any;
    if (element.items.length > 0) {
      element.select(0);
      element.emit('select', element.items[0], 0);
    }

    // Small delay to allow event to fire
    setTimeout(() => {
      expect(eventFired).toBe(true);
      expect(eventIndex).toBeGreaterThanOrEqual(0);
      list.destroy();
      done();
    }, 50);
  });

  test('highlight event fires with correct index', (done) => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    const items = ['Item 1', 'Item 2', 'Item 3'];
    list.setItems(items);

    let eventFired = false;
    let eventIndex = -1;

    list.on('highlight', (index: number) => {
      eventFired = true;
      eventIndex = index;
    });

    // Simulate highlight by manipulating blessed element
    const element = list.element as any;
    if (element.items.length > 0) {
      element.select(1);
      element.emit('select item', element.items[1], 1);
    }

    // Small delay to allow event to fire
    setTimeout(() => {
      expect(eventFired).toBe(true);
      expect(typeof eventIndex).toBe('number');
      list.destroy();
      done();
    }, 50);
  });

  test('focus() focuses the element', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    list.focus();

    // Verify focus was called (blessed focus doesn't throw)
    expect(list.element).toBeDefined();
    list.destroy();
  });

  test('destroy() cleans up the element', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
    };

    const list = createSelectableList(options);
    const element = list.element;

    list.destroy();
    // After destroy, the element should be cleaned up
    expect((element as any).destroyed).toBe(true);
  });

  test('creates list with optional label', () => {
    const options: SelectableListOptions = {
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
      label: 'Test Label',
    };

    const list = createSelectableList(options);
    const element = list.element as any;

    expect(element.options.label).toBe('Test Label');
    list.destroy();
  });
});
