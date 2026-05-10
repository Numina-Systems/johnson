# Archivist Implementation Plan

**Goal:** Implement cross-session pattern observation and self/operator updates via archivist-managed sections.

**Architecture:** The reflect stage summarizes the document store state, sends it to the sub-agent for pattern detection, then updates designated sections in `self` and `operator` documents. It uses paired `<!-- archivist-managed -->` / `<!-- /archivist-managed -->` markers to fence off editable regions. Content outside markers is never touched. The `self` document is auto-loaded every turn (token-sensitive), so its archivist section should be concise. The `operator` document is fetched on demand (token-free until read).

**Tech Stack:** TypeScript (Bun runtime), bun:test, existing SubAgentLLM interface

**Scope:** 8 phases from original design (phase 6 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC2: Automated knowledge maintenance operations
- **archivist.AC2.8 Success:** Reflect updates archivist-managed sections in `self` with knowledge domain observations
- **archivist.AC2.9 Success:** Reflect updates archivist-managed sections in `operator` with cross-session user patterns

### archivist.AC8: Full edit access to self and operator
- **archivist.AC8.1 Success:** Archivist can create new archivist-managed sections in `self` and `operator`
- **archivist.AC8.2 Success:** Archivist can rewrite content within its `<!-- archivist-managed -->` markers
- **archivist.AC8.3 Failure:** Archivist never modifies content outside `<!-- archivist-managed -->` markers in `self` or `operator`

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->
<!-- START_TASK_1 -->
### Task 1: Archivist-managed section editing (pure functions)

**Verifies:** archivist.AC8.1, archivist.AC8.2, archivist.AC8.3

**Files:**
- Create: `src/archivist/stages/reflect-sections.ts`

**Implementation:**

Create `src/archivist/stages/reflect-sections.ts` with pattern annotation `// pattern: Functional Core`. This contains the pure section-editing functions.

Marker format uses paired delimiters with a label:
```
<!-- archivist-managed: knowledge-domains -->
... archivist content ...
<!-- /archivist-managed: knowledge-domains -->
```

The label (e.g., `knowledge-domains`) distinguishes multiple archivist sections in the same document.

Pure functions:

```typescript
// pattern: Functional Core

const SECTION_PATTERN = (label: string) =>
  new RegExp(
    `<!-- archivist-managed: ${label} -->\\n[\\s\\S]*?<!-- /archivist-managed: ${label} -->`,
  );

export function getArchivistSection(content: string, label: string): string | null {
  const pattern = SECTION_PATTERN(label);
  const match = pattern.exec(content);
  if (!match) return null;
  const inner = match[0]
    .replace(`<!-- archivist-managed: ${label} -->\n`, '')
    .replace(`\n<!-- /archivist-managed: ${label} -->`, '');
  return inner;
}

export function setArchivistSection(content: string, label: string, sectionContent: string): string {
  const pattern = SECTION_PATTERN(label);
  const block = `<!-- archivist-managed: ${label} -->\n${sectionContent}\n<!-- /archivist-managed: ${label} -->`;

  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }

  return `${content}\n\n${block}`;
}

export function removeArchivistSection(content: string, label: string): string {
  const pattern = SECTION_PATTERN(label);
  return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
}
```

Key properties:
- `setArchivistSection` replaces existing section if found, appends if not (AC8.1 and AC8.2)
- Content outside markers is never modified (AC8.3) — the regex only matches within the markers
- Labels allow multiple independent archivist sections in one document

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add archivist-managed section editing functions`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Store summarization for reflection

**Verifies:** archivist.AC2.8, archivist.AC2.9

**Files:**
- Create: `src/archivist/stages/reflect.ts` (Imperative Shell — store I/O for summarization and reflection)

**Implementation:**

Add a function that produces a summary of the document store state for the sub-agent. This summary includes:
- Document count by prefix (knowledge, archive, index, skill, etc.)
- Topic clusters from `index:*` documents (titles/summaries)
- Recent archive dates
- Total document count

```typescript
type StoreSummary = {
  readonly totalDocs: number;
  readonly prefixCounts: Record<string, number>;
  readonly topicClusters: ReadonlyArray<string>;
  readonly recentArchiveDates: ReadonlyArray<string>;
};

export function summarizeStore(store: Store): StoreSummary {
  const prefixCounts: Record<string, number> = {};
  const topicClusters: Array<string> = [];
  const archiveDates = new Set<string>();
  let totalDocs = 0;

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      totalDocs++;

      const prefix = doc.rkey.includes(':') ? doc.rkey.split(':')[0]! : doc.rkey;
      prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;

      if (doc.rkey.startsWith('index:')) {
        const firstLine = doc.content.split('\n').find(l => l.startsWith('# '));
        topicClusters.push(firstLine ?? doc.rkey);
      }

      if (doc.rkey.startsWith('archive:')) {
        const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(doc.rkey);
        if (dateMatch) archiveDates.add(dateMatch[1]!);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  const sortedDates = Array.from(archiveDates).sort().reverse().slice(0, 10);

  return { totalDocs, prefixCounts, topicClusters, recentArchiveDates: sortedDates };
}

export function formatStoreSummary(summary: StoreSummary): string {
  const lines: Array<string> = [];
  lines.push(`Total documents: ${summary.totalDocs}`);
  lines.push('');
  lines.push('Documents by prefix:');
  for (const [prefix, count] of Object.entries(summary.prefixCounts).sort()) {
    lines.push(`  ${prefix}: ${count}`);
  }
  if (summary.topicClusters.length > 0) {
    lines.push('');
    lines.push('Topic clusters:');
    for (const cluster of summary.topicClusters) {
      lines.push(`  - ${cluster}`);
    }
  }
  if (summary.recentArchiveDates.length > 0) {
    lines.push('');
    lines.push('Recent archive dates:');
    for (const date of summary.recentArchiveDates) {
      lines.push(`  - ${date}`);
    }
  }
  return lines.join('\n');
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add store summarization for reflect stage`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Reflect stage execution

**Verifies:** archivist.AC2.8, archivist.AC2.9, archivist.AC8.1, archivist.AC8.2, archivist.AC8.3

**Files:**
- Modify: `src/archivist/stages/reflect.ts` (add the main reflect function, imports section functions from `reflect-sections.ts`)

**Implementation:**

Add the main `reflect()` function.

The reflect stage:
1. Call `summarizeStore()` to get the current store state
2. Format the summary via `formatStoreSummary()`
3. Send to sub-agent with two prompts:
   a. **Self observations prompt:** "Given this document store state, identify knowledge domains, emerging topics, and stale areas. Write a concise summary (bullet points, max 200 words) suitable for the agent's identity document."
   b. **Operator observations prompt:** "Given this document store state, identify cross-session user patterns, focus shifts, and preferences. Write a concise summary (bullet points, max 200 words) suitable for the user context document."
4. Load `self` document, update archivist-managed section `knowledge-domains` with self observations
5. Load `operator` document (create if absent), update archivist-managed section `user-patterns` with operator observations
6. Upsert both documents
7. Return `StageResult` with token usage

```typescript
type ReflectDeps = {
  readonly store: Store;
  readonly subAgent: SubAgentLLM;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function reflect(deps: ReflectDeps): Promise<StageResult> {
  // implementation
}
```

If no sub-agent is available, skip the stage (return `skipped: true`).

The reflect stage always runs regardless of incremental/full mode — it uses the full store summary, not the change set.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add reflect stage execution`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Reflect stage tests

**Verifies:** archivist.AC2.8, archivist.AC2.9, archivist.AC8.1, archivist.AC8.2, archivist.AC8.3

**Files:**
- Create: `src/archivist/stages/reflect.test.ts`

**Implementation:**

Create test file with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store. Mock the sub-agent.

Tests must verify:

**Pure function tests (section management):**
- `setArchivistSection` creates section when none exists (AC8.1)
- `setArchivistSection` replaces existing section content (AC8.2)
- `setArchivistSection` preserves content outside markers (AC8.3)
- `getArchivistSection` returns section content between markers
- `getArchivistSection` returns null when section doesn't exist
- `removeArchivistSection` removes section and cleans up whitespace
- Multiple labeled sections coexist independently

**Integration tests:**
- archivist.AC2.8: Reflect creates `knowledge-domains` section in `self` document
- archivist.AC2.8: Reflect updates existing `knowledge-domains` section on subsequent run
- archivist.AC2.9: Reflect creates `user-patterns` section in `operator` document
- archivist.AC2.9: Reflect creates `operator` document if it doesn't exist
- archivist.AC8.3: Content outside archivist-managed markers in `self` is unchanged after reflect
- No sub-agent: stage is skipped

**Store summarization tests:**
- `summarizeStore` counts documents by prefix
- `summarizeStore` extracts topic cluster names from index documents
- `summarizeStore` extracts recent archive dates

**Verification:**

```bash
bun test src/archivist/stages/reflect.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add reflect stage tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
