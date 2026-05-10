# Archivist Implementation Plan

**Goal:** Implement relationship detection, inline markers, and topic cluster index documents.

**Architecture:** The cross-reference stage finds related documents via embedding similarity (lower threshold than dedup, default 0.60), adds idempotent inline `<!-- related: ... -->` markers at the top of each document, and creates/updates `index:*` topic cluster documents with sub-agent-generated summaries. Markers are fully replaced each run (idempotent, not appended).

**Tech Stack:** TypeScript (Bun runtime), bun:test, existing EmbeddingProvider and SubAgentLLM interfaces

**Scope:** 8 phases from original design (phase 5 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC2: Automated knowledge maintenance operations
- **archivist.AC2.4 Success:** Cross-reference adds idempotent `<!-- related: ... -->` markers to documents with embedding similarity >= crossref threshold
- **archivist.AC2.5 Success:** Cross-reference creates/updates `index:*` topic cluster documents

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Inline marker management (pure functions)

**Verifies:** archivist.AC2.4 (marker format and idempotency)

**Files:**
- Create: `src/archivist/stages/crossref.ts`

**Implementation:**

Create `src/archivist/stages/crossref.ts`. Start with pure functions for marker management.

The `<!-- related: ... -->` marker is placed at the very top of a document. On each run, any existing marker is stripped and replaced with the current set of related rkeys. This makes the operation idempotent — running twice produces the same result.

Note: The marker uses `, ` as delimiter between rkeys. This assumes rkeys never contain commas, which is true given current rkey conventions (`prefix:name` with alphanumeric, hyphens, and colons only).

```typescript
// pattern: Imperative Shell

const RELATED_MARKER_PATTERN = /^<!-- related: .* -->\n?/;

export function stripRelatedMarker(content: string): string {
  return content.replace(RELATED_MARKER_PATTERN, '');
}

export function addRelatedMarker(content: string, relatedRkeys: ReadonlyArray<string>): string {
  if (relatedRkeys.length === 0) return stripRelatedMarker(content);
  const stripped = stripRelatedMarker(content);
  const marker = `<!-- related: ${relatedRkeys.join(', ')} -->`;
  return `${marker}\n${stripped}`;
}

export function parseRelatedMarker(content: string): ReadonlyArray<string> {
  const match = /^<!-- related: (.*) -->/.exec(content);
  if (!match) return [];
  return match[1]!.split(', ').map(s => s.trim()).filter(Boolean);
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add inline marker management for crossref`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Cross-reference stage execution

**Verifies:** archivist.AC2.4, archivist.AC2.5

**Files:**
- Modify: `src/archivist/stages/crossref.ts` (add the main crossref function and index document management)

**Implementation:**

Add the main `crossref()` function.

The cross-reference stage:
1. Load all embeddings from `store.getAllEmbeddings()`
2. Build a set of immutable rkeys using `isImmutable()` from `state.ts`
3. Call `findSimilarPairs()` from `similarity.ts` with `crossrefThreshold` (default 0.60)
4. Build an adjacency map: for each rkey, collect all related rkeys
5. For each document with related rkeys:
   a. Load the document via `store.docGet()`
   b. Call `addRelatedMarker()` to idempotently set the marker
   c. Upsert the updated document
6. Group related documents into topic clusters (connected components or overlapping groups)
7. For each cluster, create or update an `index:<topic>` document:
   a. If sub-agent available, generate a topic summary from the cluster's documents
   b. Format as a list of related rkeys with the summary
   c. Upsert as `index:<topic-slug>` document

Index document format:
```markdown
<!-- archivist-managed -->
# Topic: <sub-agent-generated topic name>

<sub-agent-generated 2-3 sentence summary>

## Related Documents
- `rkey1` — <brief description>
- `rkey2` — <brief description>
```

Index rkey generation: use a deterministic slug from the cluster's sorted rkeys (e.g., hash of sorted rkey list, truncated to 8 chars) to ensure the same cluster maps to the same `index:*` document across runs.

```typescript
import { createHash } from 'node:crypto';

function buildIndexRkey(rkeys: ReadonlyArray<string>): string {
  const sorted = [...rkeys].sort();
  const hash = createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 8);
  return `index:cluster-${hash}`;
}
```

```typescript
type CrossrefDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function crossref(
  deps: CrossrefDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  // implementation
}
```

In incremental mode, only process documents from `changeSet.added` or `changeSet.modified`. In full mode, recompute all relationships.

Graceful degradation: if no embedding provider, skip entirely. If no sub-agent, still add markers but skip index document summary generation (use a placeholder summary listing just the rkeys).

Immutable documents (`ref:*`, `skill:*`, `customtool:*`) should NOT have markers added to them (they are immutable), but they CAN appear as related targets in other documents' markers.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add crossref stage execution and index documents`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Cross-reference stage tests

**Verifies:** archivist.AC2.4, archivist.AC2.5

**Files:**
- Create: `src/archivist/stages/crossref.test.ts`

**Implementation:**

Create test file with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store. Mock embedding provider and sub-agent.

Tests must verify:

**Pure function tests (markers):**
- `addRelatedMarker` adds marker at top of document
- `addRelatedMarker` replaces existing marker (idempotent)
- `addRelatedMarker` with empty rkeys removes existing marker
- `stripRelatedMarker` removes marker, leaves content intact
- `parseRelatedMarker` extracts rkeys from marker

**Integration tests:**
- archivist.AC2.4: Documents with similarity >= threshold get related markers added
- archivist.AC2.4: Running crossref twice produces identical markers (idempotency)
- archivist.AC2.4: Immutable documents do NOT get markers added to them
- archivist.AC2.4: Immutable documents CAN appear as targets in other documents' markers
- archivist.AC2.5: Index documents are created for topic clusters
- archivist.AC2.5: Index documents are updated when new related documents appear
- No embedding provider: stage is skipped

**Verification:**

```bash
bun test src/archivist/stages/crossref.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add crossref stage tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
