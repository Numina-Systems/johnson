# Archivist Implementation Plan

**Goal:** Implement the dedup and prune stages — the two document-reducing stages of the archivist pipeline.

**Architecture:** Both stages use a two-phase approach: embedding pre-filter to find candidates, then sub-agent LLM confirmation. Dedup merges near-duplicates with audit markers. Prune removes strict information subsets and orphaned chunks. A shared `cosineSimilarity` utility is extracted for reuse across stages.

**Tech Stack:** TypeScript (Bun runtime), bun:test, existing EmbeddingProvider and SubAgentLLM interfaces

**Scope:** 8 phases from original design (phase 3 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC2: Automated knowledge maintenance operations
- **archivist.AC2.1 Success:** Dedup identifies documents with embedding similarity >= configured threshold as candidates
- **archivist.AC2.2 Success:** Dedup merges confirmed duplicates, keeping the winner with `<!-- merged-from: ... -->` marker and deleting the loser + chunks
- **archivist.AC2.6 Success:** Prune removes documents confirmed as strict information subsets of another document
- **archivist.AC2.7 Success:** Prune cleans up orphaned chunk documents whose parent no longer exists
- **archivist.AC2.10 Failure:** Sub-agent returns uncertain result for dedup candidate -- documents are left separate
- **archivist.AC2.11 Edge:** Store contains only immutable documents -- pipeline completes with no mutations

### archivist.AC4: Immutability boundaries
- **archivist.AC4.1 Success:** `ref:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.2 Success:** `skill:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.3 Success:** `customtool:*` documents are never modified or deleted by any pipeline stage

---

<!-- START_TASK_1 -->
### Task 1: Extract cosine similarity to shared utility

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/archivist/similarity.ts`

**Implementation:**

Create `src/archivist/similarity.ts` with pattern annotation `// pattern: Functional Core`.

The `cosineSimilarity` function currently exists as a private function in `src/search/hybrid.ts:41-56`. Rather than modifying the search module, create a copy in the archivist module. This avoids coupling archivist to the search module's internals.

```typescript
// pattern: Functional Core

export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export type EmbeddingPair = {
  readonly rkey: string;
  readonly embedding: ReadonlyArray<number>;
};

export function findSimilarPairs(
  embeddings: ReadonlyArray<EmbeddingPair>,
  threshold: number,
  excludeRkeys: ReadonlySet<string>,
): ReadonlyArray<{ a: string; b: string; similarity: number }> {
  const results: Array<{ a: string; b: string; similarity: number }> = [];

  for (let i = 0; i < embeddings.length; i++) {
    const ea = embeddings[i]!;
    if (excludeRkeys.has(ea.rkey)) continue;

    for (let j = i + 1; j < embeddings.length; j++) {
      const eb = embeddings[j]!;
      if (excludeRkeys.has(eb.rkey)) continue;

      const sim = cosineSimilarity(ea.embedding, eb.embedding);
      if (sim >= threshold) {
        results.push({ a: ea.rkey, b: eb.rkey, similarity: sim });
      }
    }
  }

  return results.sort((x, y) => y.similarity - x.similarity);
}
```

The `findSimilarPairs` function does the O(n^2) embedding comparison, filtering out immutable rkeys via the `excludeRkeys` set. Both dedup and prune stages will use this with different thresholds.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add cosine similarity utility`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->
<!-- START_TASK_2 -->
### Task 2: Dedup stage

**Verifies:** archivist.AC2.1, archivist.AC2.2, archivist.AC2.10, archivist.AC2.11, archivist.AC4.1, archivist.AC4.2, archivist.AC4.3

**Files:**
- Create: `src/archivist/stages/dedup.ts`

**Implementation:**

Create `src/archivist/stages/dedup.ts` with pattern annotation `// pattern: Imperative Shell`.

The dedup stage:
1. Loads all embeddings from the store via `store.getAllEmbeddings()`
2. Builds a set of immutable rkeys using `isImmutable()` from `state.ts`
3. In incremental mode, filters to only consider rkeys present in `changeSet.added` or `changeSet.modified` (at least one side of the pair must be changed)
4. Calls `findSimilarPairs()` with the configured `dedupThreshold` (default 0.88)
5. For each candidate pair, loads both documents via `store.docGet()`
6. Sends both to the sub-agent for confirmation with a structured prompt
7. Parses the sub-agent response: if confirmed, merges; if uncertain/rejected, leaves separate
8. Merge execution: keeps the "winner" (longer document), appends `<!-- merged-from: loser-rkey, ISO-timestamp -->` marker, upserts the updated winner, deletes the loser and its chunks
9. Returns a `StageResult` with token usage and action descriptions

Key implementation details:

- The sub-agent prompt should ask: "Are these two documents semantically equivalent? If yes, which should be kept (the more complete one)? Respond with JSON: `{\"duplicate\": true, \"keep\": \"a\" | \"b\"}` or `{\"duplicate\": false}`"
- Parse the sub-agent response as JSON. If parsing fails or the response is ambiguous, treat as "not duplicate" (AC2.10)
- The merged-from marker format: `<!-- merged-from: ${loserRkey}, ${new Date().toISOString()} -->`
- Chunk cleanup: find all documents matching `${loserRkey}:chunk:*` pattern via iterating docList and delete them
- If no embedding provider is available, skip the stage entirely (return `skipped: true`)
- If no sub-agent is available, skip the stage entirely
- Track tokens from sub-agent calls via the budget tracker

```typescript
// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult, BudgetTracker } from '../types.ts';
import { isImmutable } from '../state.ts';
import { findSimilarPairs } from '../similarity.ts';

type DedupDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider;
  readonly subAgent: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function dedup(
  deps: DedupDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  // implementation
}
```

For chunk cleanup, iterate the store looking for rkeys starting with `${loserRkey}:chunk:`:

```typescript
function deleteDocAndChunks(store: Store, rkey: string): number {
  let deleted = 0;
  store.docDelete(rkey);
  deleted++;

  let i = 0;
  while (store.docGet(`${rkey}:chunk:${i}`)) {
    store.docDelete(`${rkey}:chunk:${i}`);
    deleted++;
    i++;
  }

  return deleted;
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add dedup stage`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Prune stage

**Verifies:** archivist.AC2.6, archivist.AC2.7, archivist.AC4.1, archivist.AC4.2, archivist.AC4.3

**Files:**
- Create: `src/archivist/stages/prune.ts`

**Implementation:**

Create `src/archivist/stages/prune.ts` with pattern annotation `// pattern: Imperative Shell`.

The prune stage has three responsibilities:
1. **Redundancy detection** — Find documents that are strict information subsets of another. Uses embedding similarity > `pruneThreshold` (0.92) as pre-filter, then sub-agent confirms if the information in document A is entirely contained within document B.
2. **Chunk orphan cleanup** — Find `knowledge:*:chunk:*` documents whose parent `knowledge:*` document no longer exists in the store. Delete the orphans.
3. **Immutability** — Never touch `ref:*`, `skill:*`, or `customtool:*` documents.

Note: The design mentions "stale context removal: docs not recalled in N runs" but this requires recall tracking infrastructure that doesn't exist yet. Deferred to a future iteration.

Implementation structure:

```typescript
// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult, BudgetTracker } from '../types.ts';
import { isImmutable } from '../state.ts';
import { findSimilarPairs } from '../similarity.ts';

type PruneDeps = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function prune(
  deps: PruneDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  // implementation
}
```

Sub-agent prompt for subset detection: "Is document A a strict information subset of document B? That is, does B contain all the information in A (possibly with more)? Respond with JSON: `{\"subset\": true, \"superset\": \"a\" | \"b\"}` or `{\"subset\": false}`"

For chunk orphan cleanup:

```typescript
function cleanupOrphanedChunks(store: Store): number {
  let cleaned = 0;
  const chunkPattern = /^(knowledge:.+):chunk:\d+$/;

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      const match = chunkPattern.exec(doc.rkey);
      if (match) {
        const parentRkey = match[1]!;
        const parent = store.docGet(parentRkey);
        if (!parent) {
          store.docDelete(doc.rkey);
          cleaned++;
        }
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return cleaned;
}
```

Graceful degradation: `embedding` and `subAgent` are optional in `PruneDeps`. If either is missing, skip redundancy detection (still do orphan cleanup, which requires only the store). This allows the pipeline orchestrator to always call prune without non-null assertions.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add prune stage`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Dedup and prune tests

**Verifies:** archivist.AC2.1, archivist.AC2.2, archivist.AC2.6, archivist.AC2.7, archivist.AC2.10, archivist.AC2.11, archivist.AC4.1, archivist.AC4.2, archivist.AC4.3

**Files:**
- Create: `src/archivist/stages/dedup.test.ts`
- Create: `src/archivist/stages/prune.test.ts`

**Implementation:**

Create test files with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store via `createStore(':memory:')`. Mock the embedding provider and sub-agent via dependency injection (pass mock objects implementing the interfaces).

Mock embedding provider pattern:
```typescript
const mockEmbedding: EmbeddingProvider = {
  dimensions: 3,
  async embed(_text: string): Promise<Array<number>> {
    return [1, 0, 0]; // controllable per test
  },
  async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
    return texts.map(() => [1, 0, 0]);
  },
};
```

Mock sub-agent pattern:
```typescript
const mockSubAgent: SubAgentLLM = {
  async complete(_prompt: string, _system?: string): Promise<string> {
    return JSON.stringify({ duplicate: true, keep: 'a' });
  },
};
```

For dedup tests, pre-populate the store with documents and save embeddings so `getAllEmbeddings()` returns them for similarity comparison.

**Dedup tests must verify:**
- archivist.AC2.1: Pairs with similarity >= threshold are identified as candidates
- archivist.AC2.2: Confirmed duplicates are merged with `<!-- merged-from: ... -->` marker; loser and its chunks are deleted
- archivist.AC2.10: Sub-agent returning `{ duplicate: false }` leaves documents separate
- archivist.AC2.10: Sub-agent returning unparseable response leaves documents separate
- archivist.AC2.11: Store with only immutable documents produces no mutations (skipped result)
- archivist.AC4.1/4.2/4.3: Immutable documents are never candidates for dedup

**Prune tests must verify:**
- archivist.AC2.6: Documents confirmed as strict subsets are deleted
- archivist.AC2.7: Orphaned chunk documents (parent deleted) are cleaned up
- archivist.AC4.1/4.2/4.3: Immutable documents are never pruned

**Verification:**

```bash
bun test src/archivist/stages/dedup.test.ts
bun test src/archivist/stages/prune.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add dedup and prune stage tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: Export new modules from barrel

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/archivist/index.ts` (add exports for similarity, dedup, prune)

**Implementation:**

Add exports to the barrel file:

```typescript
export { cosineSimilarity, findSimilarPairs } from './similarity.ts';
export { dedup } from './stages/dedup.ts';
export { prune } from './stages/prune.ts';
export { scan } from './stages/scan.ts';
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

```bash
bun test
```

Expected: All existing tests pass plus new dedup/prune tests.

**Commit:** `feat(archivist): export dedup and prune from barrel`

<!-- END_TASK_5 -->
