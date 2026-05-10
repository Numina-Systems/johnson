// pattern: Functional Core

import type { BudgetTracker } from './types.ts';

export function createBudgetTracker(limit: number): BudgetTracker {
  const breakdown: Record<string, number> = {};
  return {
    limit,
    consumed: 0,
    breakdown,
    record(stage: string, tokens: number): void {
      this.consumed += tokens;
      breakdown[stage] = (breakdown[stage] ?? 0) + tokens;
    },
    shouldContinue(): boolean {
      if (this.limit === 0) return true;
      return this.consumed < this.limit;
    },
  };
}
