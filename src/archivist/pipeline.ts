// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ArchivistConfig, PipelineMode, PipelineResult, StageResult, BudgetTracker } from './types.ts';
import { createBudgetTracker } from './budget.ts';
import { scan } from './stages/scan.ts';
import { dedup } from './stages/dedup.ts';
import { consolidate } from './stages/consolidate.ts';
import { crossref } from './stages/crossref.ts';
import { prune } from './stages/prune.ts';
import { reflect } from './stages/reflect.ts';
import { saveSnapshot } from './state.ts';

type PipelineDeps = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly config: ArchivistConfig;
  readonly systemPrompt: string;
};

export async function runPipeline(deps: PipelineDeps, mode: PipelineMode): Promise<PipelineResult> {
  const start = Date.now();
  const budget = createBudgetTracker(deps.config.tokenBudget);
  const stages: Array<StageResult> = [];

  // Stage 1: Scan (always runs, no LLM)
  const scanResult = scan(deps.store, mode);
  stages.push(scanResult.stageResult);

  // Stage 2: Dedup (requires embedding + subAgent)
  if (deps.embedding && deps.subAgent && budget.shouldContinue()) {
    const result = await dedup(
      { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, threshold: deps.config.dedupThreshold, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet,
      mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'dedup', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 3: Consolidate (requires subAgent)
  if (deps.subAgent && budget.shouldContinue()) {
    const result = await consolidate(
      { store: deps.store, subAgent: deps.subAgent, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet,
      mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'consolidate', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 4: Cross-reference (requires embedding)
  if (deps.embedding && budget.shouldContinue()) {
    const result = await crossref(
      { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, threshold: deps.config.crossrefThreshold, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet,
      mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'crossref', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 5: Prune (orphan cleanup always runs; redundancy detection requires embedding + subAgent)
  if (budget.shouldContinue()) {
    const result = await prune(
      { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, threshold: deps.config.pruneThreshold, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet,
      mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'prune', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 6: Reflect (requires subAgent)
  if (deps.subAgent && budget.shouldContinue()) {
    const result = await reflect(
      { store: deps.store, subAgent: deps.subAgent, budget, systemPrompt: deps.systemPrompt },
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'reflect', tokensUsed: 0, actions: [], skipped: true });
  }

  // Save updated snapshot
  saveSnapshot(deps.store, {
    lastRun: new Date().toISOString(),
    mode,
    documents: scanResult.currentHashes,
  });

  return {
    mode,
    stages,
    totalTokens: budget.consumed,
    duration: Date.now() - start,
    budgetExhausted: !budget.shouldContinue(),
  };
}
