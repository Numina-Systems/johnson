# Archivist Implementation Plan

**Goal:** Wire all stages into the pipeline orchestrator, add run logging, croner timers, and integrate into main().

**Architecture:** The pipeline orchestrator runs stages in fixed order (scan -> dedup -> consolidate -> crossref -> prune -> reflect), respecting the budget tracker. The archivist lifecycle is managed via `createArchivist()` with two croner timers (daytime incremental, overnight full sweep). Wired into `main()` after store/embedding/subAgent are ready, with graceful degradation when optional deps are missing.

**Tech Stack:** TypeScript (Bun runtime), bun:test, croner (already installed)

**Scope:** 8 phases from original design (phase 7 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC1: Background subsystem runs on dual schedules
- **archivist.AC1.1 Success:** Archivist starts two croner timers on `archivist.start()` -- daytime incremental and overnight full sweep
- **archivist.AC1.2 Success:** Daytime timer fires hourly between 6am-10pm in the configured timezone
- **archivist.AC1.3 Success:** Overnight timer fires at 2am in the configured timezone
- **archivist.AC1.4 Success:** `archivist.stop()` cancels both timers cleanly
- **archivist.AC1.5 Failure:** If archivist is disabled in config, no timers are created and no pipeline runs occur
- **archivist.AC1.6 Edge:** Overlapping runs (previous run still in progress when timer fires) are skipped with a log message

### archivist.AC6: Embeddings stay current
- **archivist.AC6.1 Success:** Documents modified by the archivist have updated `updated_at` timestamps triggering existing stale-embedding detection

### archivist.AC7: Token budget and logging
- **archivist.AC7.1 Success:** Each pipeline run logs token usage breakdown by stage to `archivist:log`
- **archivist.AC7.2 Success:** When soft budget is exceeded, pipeline finishes current operation and skips remaining stages
- **archivist.AC7.3 Success:** `archivist:log` maintains a rolling window of the last N entries (configurable)

---

<!-- START_TASK_1 -->
### Task 1: Pipeline orchestrator

**Verifies:** archivist.AC7.2

**Files:**
- Create: `src/archivist/pipeline.ts`

**Implementation:**

Create `src/archivist/pipeline.ts` with pattern annotation `// pattern: Imperative Shell`.

The pipeline orchestrator runs stages in fixed order, checking the budget tracker between each stage. If `shouldContinue()` returns false, remaining stages are skipped.

```typescript
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
      scanResult.changeSet, mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'dedup', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 3: Consolidate (requires subAgent)
  if (deps.subAgent && budget.shouldContinue()) {
    const result = await consolidate(
      { store: deps.store, subAgent: deps.subAgent, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet, mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'consolidate', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 4: Cross-reference (requires embedding)
  if (deps.embedding && budget.shouldContinue()) {
    const result = await crossref(
      { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, threshold: deps.config.crossrefThreshold, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet, mode,
    );
    stages.push(result);
  } else {
    stages.push({ stage: 'crossref', tokensUsed: 0, actions: [], skipped: true });
  }

  // Stage 5: Prune (orphan cleanup always runs; redundancy detection requires embedding + subAgent)
  if (budget.shouldContinue()) {
    const result = await prune(
      { store: deps.store, embedding: deps.embedding, subAgent: deps.subAgent, threshold: deps.config.pruneThreshold, budget, systemPrompt: deps.systemPrompt },
      scanResult.changeSet, mode,
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
```

Note: The prune stage accepts optional `embedding` and `subAgent` in its deps (defined in Phase 3). Orphan cleanup always runs; redundancy detection only runs when both embedding and subAgent are present.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add pipeline orchestrator`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Run logging

**Verifies:** archivist.AC7.1, archivist.AC7.3

**Files:**
- Create: `src/archivist/logging.ts`

**Implementation:**

Create `src/archivist/logging.ts` with pattern annotation `// pattern: Imperative Shell`.

The log module appends run summaries to the `archivist:log` document as a rolling window (JSON array, last N entries where N is `config.maxLogEntries`, default 30).

```typescript
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
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add run logging`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full createArchivist with croner timers

**Verifies:** archivist.AC1.1, archivist.AC1.2, archivist.AC1.3, archivist.AC1.4, archivist.AC1.5, archivist.AC1.6

**Files:**
- Modify: `src/archivist/index.ts` (replace stub with full implementation)

**Implementation:**

Replace the Phase 1 stub `createArchivist()` with the full implementation including croner timers.

```typescript
// pattern: Imperative Shell

import { Cron } from 'croner';
import type { ArchivistDependencies, Archivist } from './types.ts';
import { runPipeline } from './pipeline.ts';
import { appendRunLog } from './logging.ts';

export function createArchivist(deps: ArchivistDependencies): Archivist {
  let daytimeCron: Cron | undefined;
  let nighttimeCron: Cron | undefined;
  let running = false;

  const systemPrompt = ''; // Will be loaded from archivist:identity in Phase 8

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
  };
}
```

Keep the existing barrel exports (types, createBudgetTracker, state functions, etc.) and add new exports:

```typescript
export { runPipeline } from './pipeline.ts';
export { appendRunLog } from './logging.ts';
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): wire croner timers into createArchivist`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire archivist into main()

**Verifies:** archivist.AC1.1, archivist.AC1.4, archivist.AC1.5

**Files:**
- Modify: `src/index.ts` (add archivist creation and lifecycle)

**Implementation:**

In `src/index.ts`, add archivist creation after `seedSelfDoc(store)` and before agent/scheduler creation. Follow the existing graceful degradation pattern (like embedding).

Add import:
```typescript
import { createArchivist } from '@/archivist/index.ts';
```

After `seedSelfDoc(store)` (around line 52) and after subAgent creation, add:

```typescript
// Archivist (optional — requires sub-agent)
let archivist: Archivist | undefined;
if (config.archivist) {
  archivist = createArchivist({
    store,
    embedding,
    subAgent,
    config: config.archivist,
    timezone: config.agent.timezone,
  });
}
```

After scheduler start (around line 190), add:

```typescript
archivist?.start();
```

In the shutdown handler (around line 193-201), add before `store.close()`:

```typescript
archivist?.stop();
```

The shutdown sequence becomes:
```typescript
archivist?.stop();
scheduler.stop();
store.close();
```

Add the `Archivist` type import:
```typescript
import type { Archivist } from '@/archivist/index.ts';
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): wire into main() lifecycle`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Pipeline and lifecycle tests

**Verifies:** archivist.AC1.1, archivist.AC1.4, archivist.AC1.5, archivist.AC1.6, archivist.AC7.1, archivist.AC7.2, archivist.AC7.3

**Files:**
- Create: `src/archivist/pipeline.test.ts`
- Create: `src/archivist/logging.test.ts`

**Implementation:**

Create test files with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store. Mock embedding and sub-agent.

**Pipeline tests:**
- archivist.AC7.2: Pipeline stops after current stage when budget exhausted
- Pipeline runs all 6 stages in order when budget allows
- Pipeline skips dedup/crossref when no embedding provider
- Pipeline skips dedup/consolidate/reflect when no sub-agent
- All stages get skipped results when deps are missing

**Logging tests:**
- archivist.AC7.1: `appendRunLog` writes token breakdown by stage to `archivist:log`
- archivist.AC7.3: Rolling window trims to maxEntries
- archivist.AC7.3: First entry creates the log document
- Multiple entries accumulate correctly

**Lifecycle tests (createArchivist):**
- archivist.AC1.5: No timers created when no sub-agent provided
- archivist.AC1.4: `stop()` can be called safely even if `start()` wasn't called
- archivist.AC1.6: Overlapping runs are skipped (test by mocking a slow pipeline)

Note: Testing actual croner timer firing is difficult in unit tests. Test the `run()` function's overlap guard behavior directly by exposing it or testing via integration.

**Verification:**

```bash
bun test src/archivist/pipeline.test.ts
bun test src/archivist/logging.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add pipeline and lifecycle tests`

<!-- END_TASK_5 -->
