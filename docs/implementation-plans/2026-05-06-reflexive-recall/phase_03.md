# Reflexive Recall Implementation Plan — Phase 3: Orchestrator and Fallback Cascade

**Goal:** Wire decomposition and retrieval into a single `performRecall()` entry point with guard conditions and fallback behavior.

**Architecture:** An Imperative Shell module (`src/recall/index.ts`) that orchestrates the Functional Core modules from Phases 1 and 2. It handles guard conditions (short messages, disabled config, missing deps, empty store), manages the fallback cascade when SubAgentLLM or embeddings are unavailable, and emits no lifecycle events itself (that's Phase 5).

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-05-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC5: Fallback Cascade
- **reflexive-recall.AC5.1 Success:** SubAgentLLM failure falls back to raw message as single hybridSearch query
- **reflexive-recall.AC5.2 Success:** Malformed JSON from SubAgentLLM triggers same fallback
- **reflexive-recall.AC5.3 Success:** Embedding failure degrades hybridSearch to FTS-only
- **reflexive-recall.AC5.4 Success:** Both SubAgentLLM and embeddings down still returns FTS results

### reflexive-recall.AC6: Guard Conditions
- **reflexive-recall.AC6.1 Success:** recall_enabled=false skips recall entirely (default behavior)
- **reflexive-recall.AC6.2 Success:** Messages < 10 chars skip recall
- **reflexive-recall.AC6.3 Success:** Empty document store skips recall (returns null)
- **reflexive-recall.AC6.4 Success:** Missing embedding provider skips recall

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: performRecall orchestrator with RecallDeps type

**Verifies:** reflexive-recall.AC5.1, reflexive-recall.AC5.2, reflexive-recall.AC5.3, reflexive-recall.AC5.4, reflexive-recall.AC6.1, reflexive-recall.AC6.2, reflexive-recall.AC6.3, reflexive-recall.AC6.4

**Files:**
- Create: `src/recall/index.ts`

**Implementation:**

Create `src/recall/index.ts` with pattern annotation `// pattern: Imperative Shell`.

**Note on existing RecallClient:** `src/recall/client.ts` (the HTTP recall client), `src/recall/client.test.ts`, and `src/recall/integration.test.ts` are left in place. The `recallClient` field on `AgentDependencies` (types.ts) and its import of `RecallClient` remain unchanged. The new local recall pipeline (`performRecall`) coexists with the old HTTP client — they serve different purposes and may be combined in the future.

Re-export public types from the submodules so consumers can import from `src/recall/`:

```typescript
export type { DecompositionResult } from './decompose.ts';
export type { RecallFragment, RecallResult } from './retrieve.ts';
```

Define `RecallDeps`:

```typescript
export type RecallDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider | undefined;
  readonly subAgent: SubAgentLLM | undefined;
  readonly tokenBudget: number;
};
```

Note: `embedding` and `subAgent` are both optional here (matching how `AgentDependencies` wires them). The orchestrator handles their absence as part of the fallback cascade and guard conditions.

Implement `performRecall(message: string, deps: RecallDeps): Promise<RecallResult | null>`:

**Guard conditions (return null early):**

1. If `message.trim().length < 10` — skip recall (AC6.2).
2. If `!deps.embedding` — skip recall (AC6.4). Without embeddings, hybridSearch falls back to FTS-only, but the design specifies this as a guard that skips recall entirely.
3. Check if store has searchable documents: `deps.store.docList(1).documents.length === 0` — skip recall (AC6.3). **Known trade-off:** `docList(1)` returns any document including `self`, which is excluded by prefix filtering. If the only document is `self`, recall proceeds but returns zero results after filtering. This wastes one SubAgentLLM call + search. Accepted as a minor inefficiency — filtering `docList` by allowed prefixes would require loading more documents upfront, which is worse for the common case where the store has many searchable docs.

**Note on AC6.1 (recall_enabled=false):** This guard is NOT checked inside `performRecall`. The caller (agent loop in Phase 5) checks the config flag before calling `performRecall()`. This keeps config awareness out of the recall module.

**Main flow (after guards pass):**

1. Record `startTime = Date.now()`.
2. **Decomposition step:** If `deps.subAgent` is available, call `decomposeMessage(message, deps.subAgent)`. If SubAgentLLM is unavailable (undefined), use `fallbackDecomposition(message)` directly (AC5.1 — SubAgentLLM failure handled).
3. **Retrieval step:** Call `retrieveContext(decomposition, { store: deps.store, embedding: deps.embedding! }, deps.tokenBudget)`. The `embedding` non-null assertion is safe here because the guard at step 2 above already returned null if embedding was missing.
4. Set `result.elapsed = Date.now() - startTime` on the returned `RecallResult`.
5. Return the result (even if fragments is empty — AC4.3 is handled by the prompt injection layer in Phase 4).

**Fallback cascade details:**

The cascade is mostly handled by the composition of Phases 1 and 2:
- **SubAgentLLM failure (AC5.1, AC5.2):** `decomposeMessage` in Phase 1 already catches errors and returns `fallbackDecomposition(message)`. Additionally, the orchestrator handles `subAgent` being undefined by skipping decomposition entirely.
- **Embedding failure (AC5.3):** `hybridSearch` in `src/search/hybrid.ts` already catches embedding errors and falls back to FTS-only (line 107 of hybrid.ts). No additional handling needed in the orchestrator.
- **Both down (AC5.4):** SubAgentLLM undefined → fallbackDecomposition (raw message as query). Embedding throws inside hybridSearch → FTS-only results. The combination still returns FTS results.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): add performRecall orchestrator with guard conditions and fallback cascade`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Orchestrator tests

**Verifies:** reflexive-recall.AC5.1, reflexive-recall.AC5.2, reflexive-recall.AC5.3, reflexive-recall.AC5.4, reflexive-recall.AC6.1, reflexive-recall.AC6.2, reflexive-recall.AC6.3, reflexive-recall.AC6.4

**Files:**
- Create: `src/recall/index.test.ts`

**Testing:**

Use `bun:test` with `describe`/`test`/`expect`. Create mock helpers following the project pattern:

- `makeMockSubAgent(response)` — same pattern as `src/agent/compaction.test.ts:87-96` (captures calls, returns preset response).
- `makeMockStore(documents)` — same pattern as `src/agent/compaction.test.ts:42-85` (no-op stubs cast as Store). Seed with test documents having different rkey prefixes.
- Mock `EmbeddingProvider` — return fixed-dimension vectors (e.g., `[1, 0, 0, ...]`). Needs `embed()`, `embedBatch()`, and `dimensions` property.

For integration-level tests, consider using `createStore(':memory:')` for a real in-memory SQLite store seeded with test documents (follows pattern from `src/tools/custom-tool-manager.test.ts`).

**Guard condition tests:**

- **reflexive-recall.AC6.2:** Message "hi" (< 10 chars) → returns null.
- **reflexive-recall.AC6.3:** Empty store (no documents) → returns null.
- **reflexive-recall.AC6.4:** `embedding: undefined` in deps → returns null.
- Normal message with valid deps → returns a RecallResult (not null).

**Fallback cascade tests:**

- **reflexive-recall.AC5.1:** `subAgent: undefined` in deps → performRecall still returns results (uses raw message as query via fallbackDecomposition).
- **reflexive-recall.AC5.2:** SubAgentLLM returns non-JSON → performRecall still returns results (fallback decomposition, verified via the decompose module's own tests, but confirm end-to-end here).
- **reflexive-recall.AC5.3:** Embedding provider that throws on `embed()` → hybridSearch degrades to FTS-only → performRecall still returns FTS results. (This tests the existing hybridSearch fallback in the context of the full pipeline.)
- **reflexive-recall.AC5.4:** Both SubAgentLLM undefined AND embedding throws → still returns FTS results on the raw message.

**Happy path test:**

- Provide valid SubAgentLLM mock returning good JSON, working embedding mock, store with `knowledge:*` and `skill:*` documents → verify result has fragments from those documents, elapsed > 0, queryCount > 0.

**Verification:**

```bash
bun test src/recall/index.test.ts
```

Expected: All tests pass.

**Commit:** `test(recall): add orchestrator integration tests`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
