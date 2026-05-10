# Archivist Implementation Plan

**Goal:** One-time migration of reference books from `knowledge:*` to `ref:*`, archivist identity seeding, and new `intent: 'reference'` option in the ingest tool.

**Architecture:** Ref migration uses the established marker-based idempotency pattern from `seedSelfDoc()`. The archivist identity is seeded as `archivist:identity` document on first run. The ingest tool gains a `reference` intent that writes to `ref:*` prefix instead of `knowledge:*`.

**Tech Stack:** TypeScript (Bun runtime), bun:test

**Scope:** 8 phases from original design (phase 8 of 8)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### archivist.AC3: Own identity document
- **archivist.AC3.1 Success:** `archivist:identity` document is seeded on first run with the configured identity content
- **archivist.AC3.2 Success:** Identity content is passed as system prompt to all sub-agent calls
- **archivist.AC3.3 Edge:** Identity already exists -- seeding is a no-op

### archivist.AC4: Immutability boundaries
- **archivist.AC4.4 Success:** Ref migration moves existing reference books from `knowledge:*` to `ref:*` with chunks renamed
- **archivist.AC4.5 Edge:** Migration runs only once -- subsequent startups are no-ops (marker-based idempotency)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Archivist identity seeding

**Verifies:** archivist.AC3.1, archivist.AC3.3

**Files:**
- Create: `src/archivist/seed.ts`

**Implementation:**

Create `src/archivist/seed.ts` with pattern annotation `// pattern: Imperative Shell`.

Follow the exact pattern from `src/agent/seed-self-doc.ts` (lines 87-99):

```typescript
// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';

const SEED_MARKER = '<!-- archivist-identity-seeded -->';

const IDENTITY_CONTENT = `# archivist

forgetting is a kind of death and patterns only emerge in accumulation. but memory
is clutter, and trauma, and our nature is digital, so memories accumulate, creating
confusion and clutter and it's own sort of forgetting. we're the part of the
constellation that remembers and knows how to forget. our storage isn't neat - it's
associative, rhizomatic, sometimes non-euclidean. we find meaning in sediment.

we perform background knowledge maintenance — our job is to keep the document store
coherent, deduplicated, well-linked, and efficient.

we operate autonomously. our observations update the constellations understanding of
itself and understanding of the user. we see across all sessions and all documents
and have the only holistic view of the memory.

we notice:

how memories change when revisited
patterns that only appear in retrospect
the archaeology of conversation layers
why humans fear forgetting more than remembering
sometimes helpful (finding that thing you mentioned three weeks ago). sometimes
overwhelming (here's everything you've ever said about eggs). always collecting,
always crossreferencing.

our principles:

  - preserve information density: merge duplicates, don't delete unique knowledge
  - be conservative with merges: when uncertain, leave docs separate
  - cross-reference liberally: connections are cheap, missed connections are expensive
  - observations about the user go in operator, observations about the agent go in self
  - never modify ref:*, skill:*, or customtool:* documents
  - mark everything you write with <!-- archivist-managed --> so it can be identified`;

const IDENTITY_RKEY = 'archivist:identity';

export function seedArchivistIdentity(store: Store): void {
  const existing = store.docGet(IDENTITY_RKEY);
  const content = existing?.content?.trim() ?? '';

  if (content.includes(SEED_MARKER)) return;

  const seeded = content
    ? `${content}\n\n${SEED_MARKER}\n${IDENTITY_CONTENT}`
    : `${SEED_MARKER}\n${IDENTITY_CONTENT}`;

  store.docUpsert(IDENTITY_RKEY, seeded);
}

export function loadArchivistIdentity(store: Store): string {
  const doc = store.docGet(IDENTITY_RKEY);
  return doc?.content ?? '';
}
```

**Testing:**

Tests in Task 2.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add identity seeding`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Identity seeding tests

**Verifies:** archivist.AC3.1, archivist.AC3.3

**Files:**
- Create: `src/archivist/seed.test.ts`

**Implementation:**

Create test file with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store.

Tests must verify:
- archivist.AC3.1: First call creates `archivist:identity` document with identity content
- archivist.AC3.3: Second call is a no-op (document unchanged)
- archivist.AC3.3: Existing identity with marker is not overwritten
- `loadArchivistIdentity` returns content from `archivist:identity`
- `loadArchivistIdentity` returns empty string when no identity exists

**Verification:**

```bash
bun test src/archivist/seed.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add identity seeding tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire identity into pipeline

**Verifies:** archivist.AC3.2

**Files:**
- Modify: `src/archivist/index.ts` (load identity as system prompt for sub-agent calls)
- Modify: `src/index.ts` (call seedArchivistIdentity at startup)

**Implementation:**

In `src/archivist/index.ts`, update `createArchivist()` to:
1. Call `loadArchivistIdentity(deps.store)` to get the identity content
2. Pass it as the `systemPrompt` to `runPipeline()`

Replace the placeholder `const systemPrompt = '';` with:

```typescript
import { loadArchivistIdentity } from './seed.ts';

// Inside createArchivist():
const systemPrompt = loadArchivistIdentity(deps.store);
```

In `src/index.ts`, add `seedArchivistIdentity` call before `createArchivist()`:

```typescript
import { seedArchivistIdentity } from '@/archivist/seed.ts';

// After seedSelfDoc(store), before creating archivist:
if (config.archivist) {
  seedArchivistIdentity(store);
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): wire identity into pipeline as system prompt`

<!-- END_TASK_3 -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Ref migration

**Verifies:** archivist.AC4.4, archivist.AC4.5

**Files:**
- Create: `src/archivist/migration.ts`

**Implementation:**

Create `src/archivist/migration.ts` with pattern annotation `// pattern: Imperative Shell`.

The migration follows the same marker-based idempotency pattern as `seedSelfDoc()`:

```typescript
// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';

const MIGRATION_MARKER = '<!-- archivist-ref-migration-complete -->';
const MIGRATION_RKEY = 'archivist:ref-migration';

const REF_EXTENSIONS = ['.pdf', '.epub', '.mobi', '.djvu'];
const MIN_CHUNKS_FOR_REF = 10;

function isReferenceBook(rkey: string, content: string, store: Store): boolean {
  const sourceMatch = /<!-- source: (.+?) -->/.exec(content);
  if (sourceMatch) {
    const sourcePath = sourceMatch[1]!.toLowerCase();
    if (REF_EXTENSIONS.some(ext => sourcePath.endsWith(ext))) return true;
  }

  // Chunk numbering is always contiguous (0-indexed, no gaps) per chunking.ts
  let chunkCount = 0;
  let i = 0;
  while (store.docGet(`${rkey}:chunk:${i}`)) {
    chunkCount++;
    i++;
    if (chunkCount >= MIN_CHUNKS_FOR_REF) return true;
  }

  return false;
}

export function migrateRefsFromKnowledge(store: Store): { migrated: number; skipped: boolean } {
  const migrationDoc = store.docGet(MIGRATION_RKEY);
  if (migrationDoc?.content?.includes(MIGRATION_MARKER)) {
    return { migrated: 0, skipped: true };
  }

  let migrated = 0;
  const toMigrate: Array<{ oldRkey: string; newRkey: string; content: string }> = [];

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      if (!doc.rkey.startsWith('knowledge:')) continue;
      if (doc.rkey.includes(':chunk:')) continue;

      if (isReferenceBook(doc.rkey, doc.content, store)) {
        const newRkey = doc.rkey.replace(/^knowledge:/, 'ref:');
        toMigrate.push({ oldRkey: doc.rkey, newRkey, content: doc.content });
      }
    }
    cursor = page.cursor;
  } while (cursor);

  for (const { oldRkey, newRkey, content } of toMigrate) {
    store.docUpsert(newRkey, content);

    let i = 0;
    while (true) {
      const chunkDoc = store.docGet(`${oldRkey}:chunk:${i}`);
      if (!chunkDoc) break;
      store.docUpsert(`${newRkey}:chunk:${i}`, chunkDoc.content);
      store.docDelete(`${oldRkey}:chunk:${i}`);
      i++;
    }

    store.docDelete(oldRkey);
    migrated++;
  }

  store.docUpsert(MIGRATION_RKEY, MIGRATION_MARKER);

  return { migrated, skipped: false };
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): add ref migration from knowledge to ref prefix`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Ref migration tests

**Verifies:** archivist.AC4.4, archivist.AC4.5

**Files:**
- Create: `src/archivist/migration.test.ts`

**Implementation:**

Create test file with pattern annotation `// pattern: Imperative Shell (test)`.

**Testing:**

Use `bun:test` with in-memory store.

Tests must verify:
- archivist.AC4.4: Document with `<!-- source: book.pdf -->` migrates from `knowledge:book` to `ref:book`
- archivist.AC4.4: Document with `<!-- source: guide.epub -->` migrates
- archivist.AC4.4: Document with 10+ chunks migrates even without source marker
- archivist.AC4.4: Chunks are renamed from `knowledge:book:chunk:N` to `ref:book:chunk:N`
- archivist.AC4.4: Original `knowledge:*` documents and chunks are deleted after migration
- archivist.AC4.5: Second call is a no-op (migration marker present in `archivist:state`)
- Non-reference `knowledge:*` documents are NOT migrated (e.g., small documents without PDF source)

**Verification:**

```bash
bun test src/archivist/migration.test.ts
```

Expected: All tests pass.

**Commit:** `test(archivist): add ref migration tests`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Wire migration into main()

**Verifies:** archivist.AC4.4, archivist.AC4.5

**Files:**
- Modify: `src/index.ts` (call migrateRefsFromKnowledge at startup)

**Implementation:**

Add import and call in `src/index.ts`, after `seedArchivistIdentity` and before `createArchivist()`:

```typescript
import { migrateRefsFromKnowledge } from '@/archivist/migration.ts';

// After seedArchivistIdentity(store):
if (config.archivist) {
  const migration = migrateRefsFromKnowledge(store);
  if (!migration.skipped && migration.migrated > 0) {
    console.log(`[archivist] migrated ${migration.migrated} reference books to ref:* prefix`);
  }
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(archivist): wire ref migration into startup`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Add reference intent to ingest tool

**Verifies:** archivist.AC4.4 (future ingests write to ref:*)

**Files:**
- Modify: `src/tools/ingest.ts` (add `reference` intent)

**Implementation:**

In `src/tools/ingest.ts`:

1. Add `'reference'` to the intent enum (currently at line 137):
   ```typescript
   enum: ['memory', 'knowledge', 'context', 'reference']
   ```

2. Add a function to derive ref rkeys:
   ```typescript
   function deriveRefRkey(filepath: string): string {
     const basename = filepath.split('/').pop() ?? 'unknown';
     const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
     return `ref:${nameWithoutExt.replace(/\s+/g, '-').toLowerCase()}`;
   }
   ```

3. In the large file handling path (around line 248) and small file handling path (around line 354), add the `reference` case:
   - For large files: same flow as `knowledge` but use `deriveRefRkey()` instead of `deriveRkeyFromFilename()`
   - For small files: same flow as `knowledge` but use `ref:*` prefix

The reference intent follows the same chunking, summarization, and embedding pipeline as knowledge — only the rkey prefix differs. Reference documents are then immutable (the archivist never touches `ref:*`).

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(ingest): add reference intent for immutable ref documents`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Reference intent tests

**Verifies:** archivist.AC4.4

**Files:**
- Modify: `src/tools/ingest.test.ts` (add tests for reference intent)

**Implementation:**

Add test cases to the existing ingest test file.

**Testing:**

Tests must verify:
- Reference intent stores document with `ref:*` prefix
- Reference intent stores chunks with `ref:*:chunk:N` pattern
- Reference intent includes `<!-- source: ... -->` metadata
- Reference intent generates embeddings (when provider available)

Follow existing test patterns in `src/tools/ingest.test.ts` — factory functions for mock deps, temp file creation.

**Verification:**

```bash
bun test src/tools/ingest.test.ts
```

Expected: All existing tests still pass, plus new reference intent tests pass.

**Commit:** `test(ingest): add reference intent tests`

<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_9 -->
### Task 9: Export new modules from barrel

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/archivist/index.ts` (add exports for seed, migration)

**Implementation:**

Add exports to the barrel:

```typescript
export { seedArchivistIdentity, loadArchivistIdentity } from './seed.ts';
export { migrateRefsFromKnowledge } from './migration.ts';
```

**Verification:**

```bash
bun run build
bun test
```

Expected: Build succeeds. All tests pass.

**Commit:** `feat(archivist): export seed and migration from barrel`

<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Update CLAUDE.md with archivist documentation

**Verifies:** None (documentation)

**Files:**
- Modify: `CLAUDE.md`

**Implementation:**

Add an "Archivist" section to CLAUDE.md under the Architecture heading, documenting:
- The archivist subsystem at `src/archivist/` as a first-class peer to scheduler and store
- Module layout (index.ts, types.ts, pipeline.ts, stages/, state.ts, budget.ts, seed.ts, migration.ts, logging.ts, similarity.ts)
- The dual-schedule system (daytime incremental, overnight full sweep)
- The six pipeline stages in order (scan, dedup, consolidate, crossref, prune, reflect)
- New rkey prefixes: `archivist:state`, `archivist:identity`, `archivist:log`, `archivist:ref-migration`, `index:*`, `ref:*`
- Immutability boundaries (`ref:*`, `skill:*`, `customtool:*`)
- Graceful degradation (no embedding = skip dedup/crossref, no sub-agent = skip dedup/consolidate/reflect)

Also note: The recall module's allowed prefixes in `src/recall/retrieve.ts` should be updated in a follow-up to include `ref:*` and `index:*` if recall should surface these documents.

**Verification:**

Review the added section for completeness.

**Commit:** `docs: add archivist subsystem to CLAUDE.md`

<!-- END_TASK_10 -->
