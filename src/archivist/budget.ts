// pattern: Functional Core

import type { BudgetTracker } from './types.ts';

export function createBudgetTracker(limit: number): BudgetTracker {
  const breakdown: Record<string, number> = {};
  let consumed = 0;
  return {
    get limit() { return limit; },
    get consumed() { return consumed; },
    set consumed(v) { consumed = v; },
    breakdown,
    record(stage: string, tokens: number): void {
      consumed += tokens;
      breakdown[stage] = (breakdown[stage] ?? 0) + tokens;
    },
    shouldContinue(): boolean {
      if (limit === 0) return true;
      return consumed < limit;
    },
  };
}
