// pattern: Functional Core

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ArchivistConfig } from '@/config/types.ts';

export type ArchivistDependencies = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly config: ArchivistConfig;
  readonly timezone: string;
};

export type ArchivistSnapshot = {
  readonly lastRun: string;
  readonly mode: 'incremental' | 'full';
  readonly documents: Record<string, string>;
};

export type ChangeSet = {
  readonly added: ReadonlyArray<string>;
  readonly modified: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
  readonly unchanged: ReadonlyArray<string>;
};

export type PipelineMode = 'incremental' | 'full';

export type StageResult = {
  readonly stage: string;
  readonly tokensUsed: number;
  readonly actions: ReadonlyArray<string>;
  readonly skipped: boolean;
};

export type PipelineResult = {
  readonly mode: PipelineMode;
  readonly stages: ReadonlyArray<StageResult>;
  readonly totalTokens: number;
  readonly duration: number;
  readonly budgetExhausted: boolean;
};

export type Archivist = {
  start(): void;
  stop(): void;
  runNow(mode: PipelineMode): Promise<void>;
};

export type BudgetTracker = {
  readonly limit: number;
  consumed: number;
  readonly breakdown: Record<string, number>;
  record(stage: string, tokens: number): void;
  shouldContinue(): boolean;
};
