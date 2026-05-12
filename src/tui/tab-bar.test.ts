// pattern: Functional Core — tab navigation utility functions
import { describe, expect, test } from 'bun:test';
import { nextTab, prevTab } from './tab-bar.ts';

describe('nextTab', () => {
  test('cycles to next tab in order', () => {
    expect(nextTab(0, 7)).toBe(1);
    expect(nextTab(1, 7)).toBe(2);
    expect(nextTab(5, 7)).toBe(6);
  });

  test('wraps from last tab to first', () => {
    expect(nextTab(6, 7)).toBe(0);
  });

  test('handles single tab (wraps to itself)', () => {
    expect(nextTab(0, 1)).toBe(0);
  });

  test('handles two tabs', () => {
    expect(nextTab(0, 2)).toBe(1);
    expect(nextTab(1, 2)).toBe(0);
  });
});

describe('prevTab', () => {
  test('cycles to previous tab in order', () => {
    expect(prevTab(1, 7)).toBe(0);
    expect(prevTab(2, 7)).toBe(1);
    expect(prevTab(6, 7)).toBe(5);
  });

  test('wraps from first tab to last', () => {
    expect(prevTab(0, 7)).toBe(6);
  });

  test('handles single tab (wraps to itself)', () => {
    expect(prevTab(0, 1)).toBe(0);
  });

  test('handles two tabs', () => {
    expect(prevTab(0, 2)).toBe(1);
    expect(prevTab(1, 2)).toBe(0);
  });
});
