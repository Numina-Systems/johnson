// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { PipelineResult } from './types.ts';

const LOG_RKEY = 'archivist:log';

type LogEntry = {
  readonly timestamp: string;
  readonly mode: string;
  readonly duration: number;
  readonly totalTokens: number;
  readonly stages: ReadonlyArray<{
    stage: string;
    tokensUsed: number;
    skipped: boolean;
    actionCount: number;
  }>;
  readonly budgetExhausted: boolean;
};

export function appendRunLog(store: Store, result: PipelineResult, maxEntries: number): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    mode: result.mode,
    duration: result.duration,
    totalTokens: result.totalTokens,
    stages: result.stages.map(s => ({
      stage: s.stage,
      tokensUsed: s.tokensUsed,
      skipped: s.skipped,
      actionCount: s.actions.length,
    })),
    budgetExhausted: result.budgetExhausted,
  };

  const doc = store.docGet(LOG_RKEY);
  let entries: Array<LogEntry> = [];

  if (doc) {
    try {
      entries = JSON.parse(doc.content) as Array<LogEntry>;
    } catch {
      entries = [];
    }
  }

  entries.push(entry);

  if (entries.length > maxEntries) {
    entries = entries.slice(entries.length - maxEntries);
  }

  store.docUpsert(LOG_RKEY, JSON.stringify(entries, null, 2));
}
