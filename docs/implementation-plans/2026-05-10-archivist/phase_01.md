# Archivist Implementation Plan

**Goal:** Establish the archivist module structure, types, configuration loading, and pure-function utilities.

**Architecture:** The archivist is a first-class subsystem at `src/archivist/`, peer to `src/scheduler/` and `src/store/`. It follows the Functional Core / Imperative Shell pattern. Types and pure functions are Functional Core; lifecycle management is Imperative Shell.

**Tech Stack:** TypeScript (Bun runtime), bun:test, croner (already installed)

**Scope:** 8 phases from original design (phase 1 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC1: Background subsystem runs on dual schedules
- **archivist.AC1.4 Success:** `archivist.stop()` cancels both timers cleanly
- **archivist.AC1.5 Failure:** If archivist is disabled in config, no timers are created and no pipeline runs occur

### archivist.AC5: State tracking across runs
- **archivist.AC5.2 Success:** Incremental run correctly identifies added, modified, and deleted documents since last run
- **archivist.AC5.4 Edge:** First run with no existing snapshot treats all documents as added

### archivist.AC7: Token budget and logging
- **archivist.AC7.4 Edge:** Token budget of 0 means unlimited -- `shouldContinue()` always returns true

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: ArchivistConfig type and config loading

**Verifies:** archivist.AC1.5

**Files:**
- Modify: `src/config/types.ts:67-76` (add `ArchivistConfig` type and `archivist?` field to `AppConfig`)
- Modify: `src/config/loader.ts:8-17` (add `archivist` to `RawConfig`)
- Modify: `src/config/loader.ts:164` (add archivist to returned `AppConfig`)
- Modify: `config.toml.example` (add commented `[archivist]` section)

**Implementation:**

Add `ArchivistConfig` type to `src/config/types.ts` before `AppConfig`:

```typescript
export type ArchivistConfig = {
  readonly enabled: boolean;
  readonly daytimeSchedule: string;
  readonly nighttimeSchedule: string;
  readonly dedupThreshold: number;
  readonly crossrefThreshold: number;
  readonly pruneThreshold: number;
  readonly tokenBudget: number;
  readonly maxLogEntries: number;
};
```

Add `archivist?` to `AppConfig`:

```typescript
readonly archivist?: ArchivistConfig;
```

In `src/config/loader.ts`, add to `RawConfig`:

```typescript
archivist?: Partial<ArchivistConfig> & Record<string, unknown>;
```

Add default constants:

```typescript
const DEFAULT_ARCHIVIST: ArchivistConfig = {
  enabled: true,
  daytimeSchedule: '0 6-22 * * *',
  nighttimeSchedule: '0 2 * * *',
  dedupThreshold: 0.88,
  crossrefThreshold: 0.60,
  pruneThreshold: 0.92,
  tokenBudget: 0,
  maxLogEntries: 30,
};
```

Load archivist config (optional section, like discord):

```typescript
const archivistEnabled = pick(raw.archivist, 'enabled', DEFAULT_ARCHIVIST.enabled);
const archivist: ArchivistConfig | undefined = archivistEnabled
  ? {
      enabled: true,
      daytimeSchedule: pick(raw.archivist, 'daytimeSchedule', DEFAULT_ARCHIVIST.daytimeSchedule),
      nighttimeSchedule: pick(raw.archivist, 'nighttimeSchedule', DEFAULT_ARCHIVIST.nighttimeSchedule),
      dedupThreshold: pick(raw.archivist, 'dedupThreshold', DEFAULT_ARCHIVIST.dedupThreshold),
      crossrefThreshold: pick(raw.archivist, 'crossrefThreshold', DEFAULT_ARCHIVIST.crossrefThreshold),
      pruneThreshold: pick(raw.archivist, 'pruneThreshold', DEFAULT_ARCHIVIST.pruneThreshold),
      tokenBudget: pick(raw.archivist, 'tokenBudget', DEFAULT_ARCHIVIST.tokenBudget),
      maxLogEntries: pick(raw.archivist, 'maxLogEntries', DEFAULT_ARCHIVIST.maxLogEntries),
    }
  : undefined;
```

Add `archivist` to the returned `AppConfig` object.

Add commented `[archivist]` section to `config.toml.example` after the `[embedding]` section (since archivist depends on both embedding and sub_model):

```toml
# --- Archivist (optional) -----------------------------------------------------
# Background knowledge maintenance. Runs on dual schedules: hourly incremental
# passes during the day and a full overnight sweep. Requires [sub_model] and
# [embedding] to be configured.
#
# [archivist]
# enabled = true
# daytime_schedule = "0 6-22 * * *"
# nighttime_schedule = "0 2 * * *"
# dedup_threshold = 0.88
# crossref_threshold = 0.60
# prune_threshold = 0.92
# token_budget = 0                   # 0 = unlimited
# max_log_entries = 30
```

**Testing:**

The config loader already has no dedicated test file (it's tested operationally). This task adds no new tests -- config loading is verified operationally by the existing `loadConfig()` calls. The `ArchivistConfig` type is verified by the TypeScript compiler.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(archivist): add ArchivistConfig type and config loading`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config loading tests

**Verifies:** archivist.AC1.5

**Files:**
- Create: `src/config/loader.test.ts`

**Implementation:**

Create a test file for config loading that covers the archivist section. The test should create a temp config.toml file, call `loadConfig()`, and verify the archivist config is parsed correctly.

**Testing:**

Tests must verify:
- archivist.AC1.5: When `[archivist]` section is absent, `config.archivist` is `undefined`
- When `[archivist]` section is present with `enabled = true`, all fields are parsed with correct defaults
- When `enabled = false`, `config.archivist` is `undefined`
- snake_case keys are accepted (e.g., `daytime_schedule` maps to `daytimeSchedule`)

Follow existing test patterns:
- Use `bun:test` with `describe/test/expect`
- Pattern annotation: `// pattern: Imperative Shell (test)` (uses filesystem for temp config files)
- Create temp config files with `writeFileSync`, clean up in `afterEach`
- Minimum viable config.toml must include required `[model]` section

**Verification:**

```bash
bun test src/config/loader.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add config loader tests for archivist section`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Archivist types

**Verifies:** None (infrastructure -- types verified by compiler)

**Files:**
- Create: `src/archivist/types.ts`

**Implementation:**

Create `src/archivist/types.ts` with pattern annotation `// pattern: Functional Core`.

```typescript
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
};

export type BudgetTracker = {
  readonly limit: number;
  consumed: number;
  readonly breakdown: Record<string, number>;
  record(stage: string, tokens: number): void;
  shouldContinue(): boolean;
};
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(archivist): add core type definitions`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Budget tracker

**Verifies:** archivist.AC7.4

**Files:**
- Create: `src/archivist/budget.ts`

**Implementation:**

Create `src/archivist/budget.ts` with pattern annotation `// pattern: Functional Core`.

```typescript
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
```

**Testing:**

Tests must verify:
- archivist.AC7.4: Token budget of 0 means unlimited -- `shouldContinue()` always returns true even after recording tokens
- `shouldContinue()` returns true when consumed < limit
- `shouldContinue()` returns false when consumed >= limit
- `record()` accumulates tokens in breakdown by stage name
- `record()` increments `consumed` total

**Verification:**

```bash
bun test src/archivist/budget.test.ts
```

Expected: All tests pass.

**Commit:** `feat(archivist): add budget tracker`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Budget tracker tests

**Verifies:** archivist.AC7.4

**Files:**
- Create: `src/archivist/budget.test.ts`

**Implementation:**

Create `src/archivist/budget.test.ts` with pattern annotation `// pattern: Functional Core (test)`.

**Testing:**

Use `bun:test` with `describe/test/expect`. Test names should reference AC identifiers:
- `archivist.AC7.4: budget of 0 means unlimited`
- `shouldContinue returns true when under budget`
- `shouldContinue returns false when at or over budget`
- `record accumulates tokens by stage`
- `record increments consumed total`

**Verification:**

```bash
bun test src/archivist/budget.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add budget tracker tests`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-8) -->
<!-- START_TASK_6 -->
### Task 6: State module -- computeChangeSet

**Verifies:** archivist.AC5.2, archivist.AC5.4

**Files:**
- Create: `src/archivist/state.ts`

**Implementation:**

Create `src/archivist/state.ts` with pattern annotation `// pattern: Functional Core`.

This module contains pure functions for snapshot comparison. It does NOT handle persistence (that comes in Phase 2).

```typescript
// pattern: Functional Core

import type { ArchivistSnapshot, ChangeSet } from './types.ts';

const IMMUTABLE_PREFIXES = ['ref:', 'skill:', 'customtool:'] as const;

export function isImmutable(rkey: string): boolean {
  return IMMUTABLE_PREFIXES.some(prefix => rkey.startsWith(prefix));
}

export function computeChangeSet(
  current: Record<string, string>,
  previous: Record<string, string> | undefined,
): ChangeSet {
  if (!previous) {
    const allKeys = Object.keys(current);
    return {
      added: allKeys,
      modified: [],
      deleted: [],
      unchanged: [],
    };
  }

  const added: Array<string> = [];
  const modified: Array<string> = [];
  const unchanged: Array<string> = [];

  for (const [rkey, hash] of Object.entries(current)) {
    if (!(rkey in previous)) {
      added.push(rkey);
    } else if (previous[rkey] !== hash) {
      modified.push(rkey);
    } else {
      unchanged.push(rkey);
    }
  }

  const deleted = Object.keys(previous).filter(rkey => !(rkey in current));

  return { added, modified, deleted, unchanged };
}

export function filterMutable(changeSet: ChangeSet): ChangeSet {
  return {
    added: changeSet.added.filter(rkey => !isImmutable(rkey)),
    modified: changeSet.modified.filter(rkey => !isImmutable(rkey)),
    deleted: changeSet.deleted.filter(rkey => !isImmutable(rkey)),
    unchanged: changeSet.unchanged,
  };
}

export function createEmptySnapshot(): ArchivistSnapshot {
  return {
    lastRun: new Date().toISOString(),
    mode: 'incremental',
    documents: {},
  };
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(archivist): add state module with computeChangeSet`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: State module tests

**Verifies:** archivist.AC5.2, archivist.AC5.4

**Files:**
- Create: `src/archivist/state.test.ts`

**Implementation:**

Create `src/archivist/state.test.ts` with pattern annotation `// pattern: Functional Core (test)`.

**Testing:**

Use `bun:test` with `describe/test/expect`. No setup/teardown needed -- pure functions.

Tests must verify:
- archivist.AC5.4: first run with no previous snapshot treats all documents as added
- archivist.AC5.2: detects added documents (present in current, absent in previous)
- archivist.AC5.2: detects modified documents (different hash in current vs previous)
- archivist.AC5.2: detects deleted documents (present in previous, absent in current)
- archivist.AC5.2: detects unchanged documents (same hash in both)
- `isImmutable` returns true for `ref:*`, `skill:*`, `customtool:*` prefixes
- `isImmutable` returns false for `knowledge:*`, `archive:*`, `self`, `operator`
- `filterMutable` removes immutable rkeys from added, modified, deleted but keeps unchanged

**Verification:**

```bash
bun test src/archivist/state.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add state module tests`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Archivist stub and barrel export

**Verifies:** archivist.AC1.4, archivist.AC1.5

**Files:**
- Create: `src/archivist/index.ts`

**Implementation:**

Create `src/archivist/index.ts` with pattern annotation `// pattern: Imperative Shell`.

This is a stub that returns the lifecycle interface. Full timer wiring comes in Phase 7.

```typescript
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
```

Also export types from the barrel:

```typescript
export type { Archivist, ArchivistDependencies, ArchivistSnapshot, ChangeSet, StageResult, PipelineResult, BudgetTracker, PipelineMode } from './types.ts';
export { createArchivist } from './index.ts';
export { createBudgetTracker } from './budget.ts';
export { computeChangeSet, filterMutable, isImmutable, createEmptySnapshot } from './state.ts';
```

Follow the pattern in `src/scheduler/index.ts` which combines the factory function and re-exports in the same file. Put the `createArchivist` function and all re-exports in `src/archivist/index.ts`.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

```bash
bun test
```

Expected: All existing tests still pass (459+). New tests from this phase also pass.

**Commit:** `feat(archivist): add createArchivist stub and barrel exports`

<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->
