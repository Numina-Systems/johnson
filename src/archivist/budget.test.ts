// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import { createBudgetTracker } from './budget.ts';

describe('BudgetTracker', () => {
  test('archivist.AC7.4: budget of 0 means unlimited', () => {
    const tracker = createBudgetTracker(0);

    // Record many tokens
    tracker.record('stage1', 1000);
    tracker.record('stage2', 2000);
    tracker.record('stage3', 3000);

    // Should still return true (unlimited)
    expect(tracker.shouldContinue()).toBe(true);
    expect(tracker.consumed).toBe(6000);
  });

  test('shouldContinue returns true when under budget', () => {
    const tracker = createBudgetTracker(1000);

    tracker.record('stage1', 500);
    expect(tracker.shouldContinue()).toBe(true);

    tracker.record('stage2', 400);
    expect(tracker.shouldContinue()).toBe(true);
  });

  test('shouldContinue returns false when at or over budget', () => {
    const tracker = createBudgetTracker(1000);

    tracker.record('stage1', 1000);
    expect(tracker.shouldContinue()).toBe(false);

    const tracker2 = createBudgetTracker(1000);
    tracker2.record('stage1', 1001);
    expect(tracker2.shouldContinue()).toBe(false);
  });

  test('record accumulates tokens by stage', () => {
    const tracker = createBudgetTracker(5000);

    tracker.record('dedup', 100);
    tracker.record('crossref', 200);
    tracker.record('dedup', 150);
    tracker.record('prune', 300);

    expect(tracker.breakdown['dedup']).toBe(250);
    expect(tracker.breakdown['crossref']).toBe(200);
    expect(tracker.breakdown['prune']).toBe(300);
  });

  test('record increments consumed total', () => {
    const tracker = createBudgetTracker(5000);

    expect(tracker.consumed).toBe(0);

    tracker.record('stage1', 100);
    expect(tracker.consumed).toBe(100);

    tracker.record('stage2', 250);
    expect(tracker.consumed).toBe(350);

    tracker.record('stage1', 75);
    expect(tracker.consumed).toBe(425);
  });
});
