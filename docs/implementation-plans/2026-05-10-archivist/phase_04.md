# Archivist Implementation Plan

**Goal:** Implement archive consolidation with progressive compression.

**Architecture:** The consolidate stage groups `archive:*` documents by date, synthesizes same-day archives into consolidated summaries via sub-agent, and applies progressive compression on subsequent sweeps. Uses HTML comment markers to track consolidation metadata (matching existing marker patterns like `<!-- merged-from: ... -->`).

**Tech Stack:** TypeScript (Bun runtime), bun:test, existing SubAgentLLM interface

**Scope:** 8 phases from original design (phase 4 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC2: Automated knowledge maintenance operations
- **archivist.AC2.3 Success:** Consolidate groups same-day archives and synthesizes them into a single summary

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Archive grouping pure functions

**Verifies:** archivist.AC2.3 (grouping logic)

**Files:**
- Create: `src/archivist/stages/consolidate.ts`

**Implementation:**

Create `src/archivist/stages/consolidate.ts`. Start with the pure grouping functions (Functional Core), then add the imperative consolidation logic.

The codebase has two archive rkey patterns:
- `archive:<YYYY-MM-DDTHH-MM-SS>` — context compaction (from `src/agent/compaction.ts:51-54`)
- `archive:session:<slug>:<YYYY-MM-DDTHH-MM>` — session archives (from `src/sessions/archive.ts:34-39`)

Both contain a parseable `YYYY-MM-DD` date. Consolidated archives will use a new pattern:
- `archive:consolidated:<YYYY-MM-DD>:<YYYY-MM-DDTHH-MM-SS>` — e.g. `archive:consolidated:2026-05-10:2026-05-10T18-45-32`

Progressive compression is tracked via an HTML comment marker in the document:
```
<!-- archivist-consolidated: depth=1, sources=3, date=2026-05-10 -->
```

Pure functions:

```typescript
// pattern: Imperative Shell

const DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/;

export function extractDate(rkey: string): string | null {
  const match = DATE_PATTERN.exec(rkey);
  if (!match) return null;
  const candidate = match[1]!;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

export function isArchiveRkey(rkey: string): boolean {
  return rkey.startsWith('archive:') && !rkey.startsWith('archivist:');
}

export function isConsolidatedRkey(rkey: string): boolean {
  return rkey.startsWith('archive:consolidated:');
}

export function getCompressionDepth(content: string): number {
  const match = /<!-- archivist-consolidated: depth=(\d+)/.exec(content);
  return match ? parseInt(match[1]!, 10) : 0;
}

export type ArchiveGroup = {
  readonly date: string;
  readonly documents: ReadonlyArray<{ rkey: string; content: string }>;
};

export function groupArchivesByDate(
  documents: ReadonlyArray<{ rkey: string; content: string }>,
): ReadonlyArray<ArchiveGroup> {
  const groups = new Map<string, Array<{ rkey: string; content: string }>>();

  for (const doc of documents) {
    if (!isArchiveRkey(doc.rkey)) continue;
    const date = extractDate(doc.rkey);
    if (!date) continue;

    const existing = groups.get(date);
    if (existing) {
      existing.push(doc);
    } else {
      groups.set(date, [doc]);
    }
  }

  return Array.from(groups.entries())
    .map(([date, docs]) => ({ date, documents: docs }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildConsolidatedRkey(date: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `archive:consolidated:${date}:${ts}`;
}

export function buildConsolidationMarker(depth: number, sourceCount: number, date: string): string {
  return `<!-- archivist-consolidated: depth=${depth}, sources=${sourceCount}, date=${date} -->`;
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add archive grouping functions for consolidate stage`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Consolidation execution

**Verifies:** archivist.AC2.3

**Files:**
- Modify: `src/archivist/stages/consolidate.ts` (add the imperative consolidation function)

**Implementation:**

Add the main `consolidate()` function to the file created in Task 1.

The consolidation logic:
1. Load all `archive:*` documents from the store via cursor-paginated `docList()`
2. Call `groupArchivesByDate()` to group by date
3. For each group with 2+ documents:
   a. Concatenate all document contents
   b. Determine compression depth: max depth of any source + 1
   c. Send to sub-agent with a prompt calibrated to the compression depth:
      - depth 0->1: "Synthesize these conversation archives into a coherent summary. Preserve key details, decisions, and action items."
      - depth 1->2: "Compress this consolidated archive further. Keep only the highest-level insights, decisions, and outcomes."
      - depth 2+: "Aggressively compress this archive to essential facts only."
   d. Write the consolidated document with `buildConsolidatedRkey(date)`
   e. Prepend the consolidation marker
   f. Delete the original source documents
4. For already-consolidated single documents (depth > 0), apply further compression on full sweeps only
5. Return `StageResult` with token usage

```typescript
type ConsolidateDeps = {
  readonly store: Store;
  readonly subAgent: SubAgentLLM;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function consolidate(
  deps: ConsolidateDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  // implementation
}
```

In incremental mode, only consolidate groups that contain at least one document from `changeSet.added` or `changeSet.modified`. In full mode, also re-compress existing consolidated documents.

If no sub-agent is available, skip the stage (return `skipped: true`).

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add consolidation execution logic`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Consolidate stage tests

**Verifies:** archivist.AC2.3

**Files:**
- Create: `src/archivist/stages/consolidate.test.ts`

**Implementation:**

Create test file with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store. Mock the sub-agent via dependency injection.

Tests must verify:

**Pure function tests (grouping):**
- `extractDate` extracts YYYY-MM-DD from both archive rkey formats
- `extractDate` returns null for non-archive rkeys
- `isArchiveRkey` returns true for `archive:*` but false for `archivist:*`
- `groupArchivesByDate` groups same-day archives together
- `groupArchivesByDate` ignores non-archive documents
- `getCompressionDepth` returns 0 for un-consolidated documents
- `getCompressionDepth` parses depth from consolidation marker

**Integration tests (consolidation execution):**
- archivist.AC2.3: Two same-day archives are consolidated into one document with consolidation marker
- archivist.AC2.3: Consolidated document contains sub-agent's synthesis
- archivist.AC2.3: Original source documents are deleted after consolidation
- Single-archive day: no consolidation occurs (need 2+ to consolidate)
- archivist.AC2.3: Progressive compression — already-consolidated document (depth=1) gets further compressed to depth=2 on full sweep
- No sub-agent: stage is skipped

**Verification:**

```bash
bun test src/archivist/stages/consolidate.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add consolidate stage tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
