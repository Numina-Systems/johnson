// pattern: Imperative Shell

import { Cron } from 'croner';
import type { ArchivistDependencies, Archivist } from './types.ts';
import { runPipeline } from './pipeline.ts';
import { appendRunLog } from './logging.ts';
import { loadArchivistIdentity } from './seed.ts';

export function createArchivist(deps: ArchivistDependencies): Archivist {
  let daytimeCron: Cron | undefined;
  let nighttimeCron: Cron | undefined;
  let running = false;

  const systemPrompt = loadArchivistIdentity(deps.store);

  async function run(mode: 'incremental' | 'full'): Promise<void> {
    if (running) {
      console.log(`[archivist] skipping ${mode} run — previous run still in progress`);
      return;
    }

    running = true;
    try {
      console.log(`[archivist] starting ${mode} run`);
      const result = await runPipeline(
        { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, config: deps.config, systemPrompt },
        mode,
      );
      appendRunLog(deps.store, result, deps.config.maxLogEntries);
      console.log(`[archivist] ${mode} run complete: ${result.totalTokens} tokens, ${result.duration}ms`);
    } catch (err) {
      console.error(`[archivist] ${mode} run failed:`, err);
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      if (!deps.subAgent) {
        console.log('[archivist] disabled — no sub-agent configured');
        return;
      }

      daytimeCron = new Cron(deps.config.daytimeSchedule, { catch: true, timezone: deps.timezone });
      daytimeCron.schedule(() => { run('incremental').catch(console.error); });

      nighttimeCron = new Cron(deps.config.nighttimeSchedule, { catch: true, timezone: deps.timezone });
      nighttimeCron.schedule(() => { run('full').catch(console.error); });

      console.log(`[archivist] started — daytime: ${deps.config.daytimeSchedule}, nighttime: ${deps.config.nighttimeSchedule}`);
    },

    stop(): void {
      daytimeCron?.stop();
      nighttimeCron?.stop();
      daytimeCron = undefined;
      nighttimeCron = undefined;
      console.log('[archivist] stopped');
    },

    async runNow(mode: 'incremental' | 'full'): Promise<void> {
      await run(mode);
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
export { cosineSimilarity, findSimilarPairs } from './similarity.ts';
export type { EmbeddingPair } from './similarity.ts';
export { dedup } from './stages/dedup.ts';
export { prune } from './stages/prune.ts';
export { scan } from './stages/scan.ts';
export { runPipeline } from './pipeline.ts';
export { appendRunLog } from './logging.ts';
export { seedArchivistIdentity, loadArchivistIdentity } from './seed.ts';
