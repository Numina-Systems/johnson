// Direct unit tests for scroll-utils pure functions

import { describe, test, expect } from 'bun:test';
import { isAtBottom } from './scroll-utils.ts';

describe('isAtBottom', () => {
  test('returns true when at bottom within tolerance', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    const scrollPos = scrollHeight - viewHeight;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('returns true when above bottom but within tolerance (2 lines)', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    // At bottom - 1 line (still within 2-line tolerance)
    const scrollPos = scrollHeight - viewHeight - 1;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('returns true when at the exact bottom boundary', () => {
    const scrollHeight = 50;
    const viewHeight = 5;
    const scrollPos = scrollHeight - viewHeight;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('returns false when not at bottom', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    const scrollPos = 0; // at top

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(false);
  });

  test('returns false when scrolled up from bottom', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    const scrollPos = scrollHeight - viewHeight - 10; // 10 lines from bottom

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(false);
  });

  test('handles case where scrollHeight <= viewHeight (content fits)', () => {
    // When content fits in viewport, scrollHeight might be less than viewHeight
    const scrollHeight = 5;
    const viewHeight = 10;
    const scrollPos = 0;

    // Since scrollHeight - viewHeight = -5, and scrollPos >= -5 - 2 is true
    const result = isAtBottom(scrollPos, scrollHeight, viewHeight);
    expect(typeof result).toBe('boolean');
  });

  test('returns true when content fits (no scroll needed)', () => {
    const scrollHeight = 8;
    const viewHeight = 10;
    const scrollPos = 0;

    // With content fitting, position 0 is effectively "at bottom"
    const result = isAtBottom(scrollPos, scrollHeight, viewHeight);
    expect(result).toBe(true);
  });

  test('handles zero values gracefully', () => {
    expect(isAtBottom(0, 0, 0)).toBe(true);
  });

  test('handles edge case: zero scroll position with zero scroll height', () => {
    const scrollPos = 0;
    const scrollHeight = 0;
    const viewHeight = 5;

    // 0 >= 0 - 5 - 2 => 0 >= -7 => true
    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('respects tolerance boundary: just outside tolerance', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    // Just outside the 2-line tolerance (3 lines from bottom)
    const scrollPos = scrollHeight - viewHeight - 3;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(false);
  });

  test('respects tolerance boundary: exactly at tolerance edge', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    // Exactly 2 lines from bottom (at the edge of tolerance)
    const scrollPos = scrollHeight - viewHeight - 2;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('handles large numbers', () => {
    const scrollHeight = 1000000;
    const viewHeight = 100;
    const scrollPos = scrollHeight - viewHeight;

    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(true);
  });

  test('handles negative scroll position (edge case)', () => {
    const scrollHeight = 100;
    const viewHeight = 10;
    const scrollPos = -5;

    // -5 >= 100 - 10 - 2 => -5 >= 88 => false
    expect(isAtBottom(scrollPos, scrollHeight, viewHeight)).toBe(false);
  });
});
