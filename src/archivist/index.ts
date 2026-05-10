// pattern: Imperative Shell

import type { ArchivistDependencies, Archivist } from './types.ts';

export function createArchivist(deps: ArchivistDependencies): Archivist {
  return {
    start(): void {
      // Timer setup wired in Phase 7
    },
    stop(): void {
      // Timer cleanup wired in Phase 7
    },
  };
}

// Barrel exports
export type {
  Archivist,
  ArchivistDependencies,
  ArchivistSnapshot,
  ChangeSet,
  StageResult,
  PipelineResult,
  BudgetTracker,
  PipelineMode,
} from './types.ts';
export { createBudgetTracker } from './budget.ts';
export { computeChangeSet, filterMutable, isImmutable, createEmptySnapshot, loadSnapshot, saveSnapshot } from './state.ts';
