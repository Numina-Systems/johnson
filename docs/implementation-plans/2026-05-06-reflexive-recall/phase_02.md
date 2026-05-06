# Reflexive Recall Implementation Plan — Phase 2: Retrieval Pipeline

**Goal:** Multi-query search with deduplication, prefix filtering, and token-budgeted ranking.

**Architecture:** A Functional Core module (`src/recall/retrieve.ts`) that takes a `DecompositionResult` from Phase 1, runs each semantic query through `hybridSearch()` and each entity through `Store.docSearch()`, deduplicates by rkey, filters to allowed prefixes, ranks by combined RRF score, and trims results to a token budget.

**Tech Stack:** TypeScript, Bun, existing hybridSearch and Store interfaces

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-05-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC2: Retrieval
- **reflexive-recall.AC2.1 Success:** Each semantic query returns up to 5 results via hybridSearch
- **reflexive-recall.AC2.2 Success:** Named entities return results via direct FTS lookup (limit 3 per entity)
- **reflexive-recall.AC2.3 Success:** Results from multiple queries are merged and ranked by RRF score

### reflexive-recall.AC3: Prefix Filtering
- **reflexive-recall.AC3.1 Success:** knowledge:\*, skill:\*, archive:\* documents appear in results
- **reflexive-recall.AC3.2 Failure:** self and operator documents are excluded from results
- **reflexive-recall.AC3.3 Failure:** task:\* documents are excluded

### reflexive-recall.AC4: Token Budget
- **reflexive-recall.AC4.1 Success:** Total recalled content is <= 1500 tokens (configurable)
- **reflexive-recall.AC4.2 Success:** If a single fragment exceeds remaining budget, it is truncated not dropped
- **reflexive-recall.AC4.3 Edge:** Zero matching documents produces no system prompt section

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: RecallFragment and RecallResult types, prefix filtering, and deduplication

**Verifies:** reflexive-recall.AC2.3, reflexive-recall.AC3.1, reflexive-recall.AC3.2, reflexive-recall.AC3.3

**Files:**
- Create: `src/recall/retrieve.ts`

**Implementation:**

Create `src/recall/retrieve.ts` with pattern annotation `// pattern: Functional Core`.

Define types:

```typescript
export type RecallFragment = {
  readonly rkey: string;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
};

export type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};
```

Implement pure helper functions:

**`filterByPrefix(fragments, allowedPrefixes)`** — Filters an array of fragments to only those whose rkey starts with one of the allowed prefixes. The default allowed prefixes are `['knowledge:', 'skill:', 'archive:']`. This excludes `self`, `operator`, `task:*`, and `customtool:*` documents.

```typescript
const DEFAULT_ALLOWED_PREFIXES: ReadonlyArray<string> = ['knowledge:', 'skill:', 'archive:'];

export function filterByPrefix(
  fragments: ReadonlyArray<RecallFragment>,
  allowedPrefixes: ReadonlyArray<string> = DEFAULT_ALLOWED_PREFIXES,
): Array<RecallFragment> {
  return fragments.filter(f => allowedPrefixes.some(p => f.rkey.startsWith(p)));
}
```

**`deduplicateFragments(fragments)`** — Deduplicates by rkey, keeping the entry with the highest score. Returns a new array.

```typescript
export function deduplicateFragments(
  fragments: ReadonlyArray<RecallFragment>,
): Array<RecallFragment> {
  const seen = new Map<string, RecallFragment>();
  for (const f of fragments) {
    const existing = seen.get(f.rkey);
    if (!existing || f.score > existing.score) {
      seen.set(f.rkey, f);
    }
  }
  return Array.from(seen.values());
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): add RecallFragment/RecallResult types with filtering and dedup helpers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Token budgeting and retrieveContext function

**Verifies:** reflexive-recall.AC2.1, reflexive-recall.AC2.2, reflexive-recall.AC2.3, reflexive-recall.AC4.1, reflexive-recall.AC4.2, reflexive-recall.AC4.3

**Files:**
- Modify: `src/recall/retrieve.ts`

**Implementation:**

Import `estimateTokens` from `../agent/context.ts`. Import `DecompositionResult` from `./decompose.ts`. Import `HybridSearchResult` from `../search/hybrid.ts` and `Store` from `../store/store.ts`. Import `EmbeddingProvider` from the embedding module (check actual import path — the investigator found `HybridSearchDeps` contains `store` and `embedding`).

**`trimToTokenBudget(fragments, budget)`** — Takes ranked fragments and a token budget. Iterates in score order (descending). For each fragment, estimates tokens via `estimateTokens(fragment.content)`. If the fragment fits within remaining budget, include it whole. If it exceeds remaining budget but remaining budget > 0, truncate the content to fit (slice characters to `remainingBudget * 4` since estimateTokens uses `length / 4`) and include the truncated fragment. Stop when budget is exhausted. Returns `{ fragments, totalTokens }`.

**Note on truncation:** `content.slice(0, remaining * 4)` uses character-level slicing which could split multi-byte UTF-8 codepoints. For the current use case (mostly English document content), this is acceptable. If non-ASCII content becomes common, consider truncating at the last space boundary (`content.lastIndexOf(' ', remaining * 4)`) for cleaner output.

```typescript
export function trimToTokenBudget(
  fragments: ReadonlyArray<RecallFragment>,
  budget: number,
): { fragments: Array<RecallFragment>; totalTokens: number } {
  const result: Array<RecallFragment> = [];
  let totalTokens = 0;

  for (const f of fragments) {
    const tokens = estimateTokens(f.content);
    if (totalTokens + tokens <= budget) {
      result.push(f);
      totalTokens += tokens;
    } else {
      const remaining = budget - totalTokens;
      if (remaining > 0) {
        const truncatedContent = f.content.slice(0, remaining * 4);
        result.push({ ...f, content: truncatedContent });
        totalTokens += estimateTokens(truncatedContent);
      }
      break;
    }
  }

  return { fragments: result, totalTokens };
}
```

**`retrieveContext(decomposition, deps, tokenBudget, allowedPrefixes?)`** — The main entry point.

The `deps` parameter needs `store` and `embedding` for hybridSearch, plus the `store` alone for entity FTS lookup. Use a type that matches `HybridSearchDeps` from `src/search/hybrid.ts` (which has `{ store: Store; embedding: EmbeddingProvider }`).

Steps:
1. Record start time with `Date.now()`.
2. For each query in `decomposition.queries`, call `hybridSearch(deps, query, 5)`. Collect results, mapping each `HybridSearchResult` to a `RecallFragment` with `source: 'semantic'`.
3. For each entity in `decomposition.entities`, call `deps.store.docSearch(entity, 3)`. Map results to `RecallFragment` with `source: 'entity'`. For entity results, since `docSearch` returns `rank` (lower is better) not an RRF score, convert to a comparable score: `1 / (60 + rank)` to match the RRF convention.
4. Combine all fragments into a single array.
5. Call `filterByPrefix()` to exclude disallowed prefixes.
6. Call `deduplicateFragments()`.
7. Sort descending by score.
8. Call `trimToTokenBudget()` with the configured budget.
9. Return a `RecallResult` with the trimmed fragments, totalTokens, queryCount (number of queries + entities executed), and elapsed time.

Handle the case where `hybridSearch` throws (e.g., embedding failure) — catch per-query and continue with remaining queries. If all queries fail, the result will just have entity results (or empty).

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): add retrieveContext with token budgeting and multi-query retrieval`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Retrieval pipeline tests

**Verifies:** reflexive-recall.AC2.1, reflexive-recall.AC2.2, reflexive-recall.AC2.3, reflexive-recall.AC3.1, reflexive-recall.AC3.2, reflexive-recall.AC3.3, reflexive-recall.AC4.1, reflexive-recall.AC4.2, reflexive-recall.AC4.3

**Files:**
- Create: `src/recall/retrieve.test.ts`

**Testing:**

Use `bun:test` with `describe`/`test`/`expect`. Follow the project's mock pattern — create mock `hybridSearch` deps (mock store with `docSearch` returning preset results, mock embedding provider).

Since `retrieveContext` calls `hybridSearch` which requires `HybridSearchDeps`, and we want to test the retrieval logic in isolation, consider testing the pure helpers directly AND the full `retrieveContext` with mocked deps.

**filterByPrefix tests:**

- **reflexive-recall.AC3.1:** Fragments with rkeys `knowledge:foo`, `skill:bar`, `archive:2024-01-01` pass through.
- **reflexive-recall.AC3.2:** Fragments with rkeys `self`, `operator` are excluded.
- **reflexive-recall.AC3.3:** Fragments with rkey `task:research` are excluded.
- Also: `customtool:foo` is excluded.

**deduplicateFragments tests:**

- **reflexive-recall.AC2.3:** Two fragments with same rkey but different scores — keeps the higher-scored one.
- Fragments with different rkeys are both kept.

**trimToTokenBudget tests:**

- **reflexive-recall.AC4.1:** Three fragments totalling under 1500 tokens — all included, totalTokens matches.
- **reflexive-recall.AC4.1:** Fragments exceeding 1500 token budget — only enough fragments included to stay within budget.
- **reflexive-recall.AC4.2:** Single large fragment exceeding budget — gets truncated (not dropped), included with shortened content.
- **reflexive-recall.AC4.3:** Empty fragments array returns empty result with totalTokens=0.

**retrieveContext integration tests (with mocked deps):**

Create mock deps where:
- `hybridSearch` is mocked by providing a mock store and mock embedding. Since `hybridSearch` is imported as a module function, you may need to mock at the deps level or test through the actual hybridSearch with an in-memory store. Use `createStore(':memory:')` for a real in-memory store and seed it with test documents. For the embedding provider, create a mock that returns consistent vectors so hybridSearch can compute cosine similarity.

Alternatively, if directly mocking hybridSearch is simpler, extract the hybridSearch call into a dep or test the pure helpers thoroughly and do a lighter integration test for retrieveContext.

The key test scenarios:
- **reflexive-recall.AC2.1:** A decomposition with 2 semantic queries returns results from both queries (up to 5 per query).
- **reflexive-recall.AC2.2:** A decomposition with 1 entity returns FTS results (up to 3).
- **reflexive-recall.AC2.3:** Results from semantic and entity queries are merged, deduplicated, and ranked by score.

**Verification:**

```bash
bun test src/recall/retrieve.test.ts
```

Expected: All tests pass.

**Commit:** `test(recall): add retrieval pipeline unit tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
