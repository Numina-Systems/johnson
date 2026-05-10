# Archivist Background Agent Design

## Summary

The Archivist is a background maintenance subsystem for the agent's document store — a persistent SQLite database holding the agent's memory as flat key-value documents. Over time, that store accumulates redundancy: duplicate knowledge fragments, overlapping conversation snapshots, related documents with no links between them, and bloated memory sections that no longer reflect current reality. The Archivist addresses this autonomously, without user intervention.

It operates on two schedules: hourly passes during the day that process only documents that have changed since the last run, and a nightly full sweep that examines everything. Each run moves through a fixed pipeline of six stages — detecting changes via content hashing, deduplicating semantically similar documents, consolidating conversation archives, pruning strict information subsets, cross-referencing related documents with inline markers and topic cluster index entries, and finally observing patterns across the whole store to update the agent's identity and user context documents. For any task requiring semantic judgement (are these duplicates? is this a subset? what patterns emerge?), the Archivist delegates to a sub-agent LLM rather than applying heuristics alone.

The Archivist lives at `src/archivist/` as a first-class peer to the scheduler and store subsystems, with direct store access rather than going through the sandbox. It has its own identity document that frames its purpose and principles, its own state document for tracking what has already been processed, and a rolling log of token usage per run. Certain document prefixes — skills, custom tools, and reference books — are immutable: the Archivist will never touch them. A one-time startup migration moves existing reference material from the general `knowledge:*` prefix to the new protected `ref:*` namespace.

## Definition of Done

1. **A background subsystem exists** that runs on its own timers with two modes: hourly incremental passes (6am-10pm) and overnight full sweeps (10pm-6am), respecting the configured timezone
2. **It performs automated knowledge maintenance**: deduplication of similar documents, consolidation of archive fragments, pruning of redundant context, cross-referencing related docs (inline markers + index documents), and updating `self` and `operator` with observed patterns
3. **It has its own identity** — a separate identity document that defines its purpose and instructions, distinct from the main agent's `self`
4. **It respects immutability boundaries** — `ref:*`, `skill:*`, and `customtool:*` documents are never modified or deleted. A migration step moves existing reference books from `knowledge:*` to `ref:*`
5. **It tracks its own state** across runs — knows what it's already processed, what changed since last run
6. **Embeddings stay current** — modified documents trigger reindexing through existing infrastructure
7. **Token usage is logged** per run (soft budget) for cost monitoring
8. **It can fully edit `self` and `operator`** — reorganize, trim, refine, update with cross-session patterns it observes

## Acceptance Criteria

### archivist.AC1: Background subsystem runs on dual schedules
- **archivist.AC1.1 Success:** Archivist starts two croner timers on `archivist.start()` — daytime incremental and overnight full sweep
- **archivist.AC1.2 Success:** Daytime timer fires hourly between 6am-10pm in the configured timezone
- **archivist.AC1.3 Success:** Overnight timer fires at 2am in the configured timezone
- **archivist.AC1.4 Success:** `archivist.stop()` cancels both timers cleanly
- **archivist.AC1.5 Failure:** If archivist is disabled in config, no timers are created and no pipeline runs occur
- **archivist.AC1.6 Edge:** Overlapping runs (previous run still in progress when timer fires) are skipped with a log message

### archivist.AC2: Automated knowledge maintenance operations
- **archivist.AC2.1 Success:** Dedup identifies documents with embedding similarity >= configured threshold as candidates
- **archivist.AC2.2 Success:** Dedup merges confirmed duplicates, keeping the winner with `<!-- merged-from: ... -->` marker and deleting the loser + chunks
- **archivist.AC2.3 Success:** Consolidate groups same-day archives and synthesizes them into a single summary
- **archivist.AC2.4 Success:** Cross-reference adds idempotent `<!-- related: ... -->` markers to documents with embedding similarity >= crossref threshold
- **archivist.AC2.5 Success:** Cross-reference creates/updates `index:*` topic cluster documents
- **archivist.AC2.6 Success:** Prune removes documents confirmed as strict information subsets of another document
- **archivist.AC2.7 Success:** Prune cleans up orphaned chunk documents whose parent no longer exists
- **archivist.AC2.8 Success:** Reflect updates archivist-managed sections in `self` with knowledge domain observations
- **archivist.AC2.9 Success:** Reflect updates archivist-managed sections in `operator` with cross-session user patterns
- **archivist.AC2.10 Failure:** Sub-agent returns uncertain result for dedup candidate — documents are left separate
- **archivist.AC2.11 Edge:** Store contains only immutable documents — pipeline completes with no mutations

### archivist.AC3: Own identity document
- **archivist.AC3.1 Success:** `archivist:identity` document is seeded on first run with the configured identity content
- **archivist.AC3.2 Success:** Identity content is passed as system prompt to all sub-agent calls
- **archivist.AC3.3 Edge:** Identity already exists — seeding is a no-op

### archivist.AC4: Immutability boundaries
- **archivist.AC4.1 Success:** `ref:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.2 Success:** `skill:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.3 Success:** `customtool:*` documents are never modified or deleted by any pipeline stage
- **archivist.AC4.4 Success:** Ref migration moves existing reference books from `knowledge:*` to `ref:*` with chunks renamed
- **archivist.AC4.5 Edge:** Migration runs only once — subsequent startups are no-ops (marker-based idempotency)

### archivist.AC5: State tracking across runs
- **archivist.AC5.1 Success:** Snapshot persists to `archivist:state` after each run with rkey-to-hash map
- **archivist.AC5.2 Success:** Incremental run correctly identifies added, modified, and deleted documents since last run
- **archivist.AC5.3 Success:** Full sweep processes all documents regardless of snapshot state
- **archivist.AC5.4 Edge:** First run with no existing snapshot treats all documents as added

### archivist.AC6: Embeddings stay current
- **archivist.AC6.1 Success:** Documents modified by the archivist have updated `updated_at` timestamps triggering existing stale-embedding detection

### archivist.AC7: Token budget and logging
- **archivist.AC7.1 Success:** Each pipeline run logs token usage breakdown by stage to `archivist:log`
- **archivist.AC7.2 Success:** When soft budget is exceeded, pipeline finishes current operation and skips remaining stages
- **archivist.AC7.3 Success:** `archivist:log` maintains a rolling window of the last N entries (configurable)
- **archivist.AC7.4 Edge:** Token budget of 0 means unlimited — `shouldContinue()` always returns true

### archivist.AC8: Full edit access to self and operator
- **archivist.AC8.1 Success:** Archivist can create new archivist-managed sections in `self` and `operator`
- **archivist.AC8.2 Success:** Archivist can rewrite content within its `<!-- archivist-managed -->` markers
- **archivist.AC8.3 Failure:** Archivist never modifies content outside `<!-- archivist-managed -->` markers in `self` or `operator`

## Glossary

- **rkey**: Short for "record key." The unique string identifier for a document in the store. Follows a `prefix:name` convention (e.g., `skill:summarize`, `archive:2026-01-15`). Prefix determines document type and mutability rules.
- **Functional Core / Imperative Shell (FCIS)**: An architectural pattern enforced throughout this codebase. Functional Core modules contain pure functions with no side effects; Imperative Shell modules handle I/O, scheduling, and mutation.
- **Sub-agent LLM**: A lightweight, single-shot language model interface used for utility tasks (summarisation, dedup confirmation, pattern detection) without consuming rounds in the main agent's conversation loop.
- **croner**: A TypeScript cron scheduling library used for the Archivist's dual timers and already used by the existing scheduler subsystem.
- **WAL mode**: Write-Ahead Logging, a SQLite concurrency mode. Allows concurrent reads while a write is in progress, enabling the Archivist and main agent to share the store without explicit locking.
- **cosine similarity**: A measure of similarity between two embedding vectors, ranging from -1 to 1. Thresholds vary by stage: 0.88 for dedup, 0.6 for cross-reference, 0.92 for prune.
- **embedding**: A numeric vector representation of a document's semantic content, produced by an embedding model. Enables similarity search across documents without exact text matching.
- **FTS5**: SQLite's built-in full-text search extension. Used for keyword-based document lookups, complementing embedding-based similarity search.
- **`archivist-managed` markers**: HTML comment delimiters (`<!-- archivist-managed -->`) that fence off sections in `self` and `operator` documents that the Archivist may freely rewrite. Content outside these markers is never touched.
- **ChangeSet**: A typed structure produced by the Scan stage listing which document rkeys were added, modified, deleted, or unchanged since the last run snapshot.
- **`self` document**: The agent's own identity and context document, loaded into the system prompt every turn. The Archivist can update designated sections within it.
- **`operator` document**: A document storing user-specific preferences and context, intentionally not auto-loaded. The Archivist updates it with cross-session patterns.
- **soft budget**: A token consumption limit that is advisory rather than hard-enforced. When exceeded, the pipeline completes its current operation cleanly and defers remaining stages to the next run.
- **chunk documents**: When a large document is ingested, it is split into `knowledge:name:chunk:N` sub-documents for embedding. The Archivist cleans up orphaned chunks whose parent document no longer exists.
- **progressive compression**: A consolidation strategy where older archive documents receive more aggressive summarisation on each subsequent sweep, trading detail for token efficiency over time.
- **idempotent**: An operation that produces the same result regardless of how many times it is applied. Used here for inline `<!-- related: ... -->` markers, which are fully replaced each run rather than appended.
- **`index:*` documents**: Topic cluster documents created by the cross-reference stage, grouping related documents under a sub-agent-generated summary. Owned entirely by the Archivist.

## Architecture

The archivist is a first-class subsystem at `src/archivist/`, peer to the scheduler (`src/scheduler/`) and store (`src/store/`). It has direct store access — no sandbox mediation — and uses the sub-agent LLM for analysis tasks (dedup confirmation, summarization, pattern recognition). It manages its own timers via `croner` independently of the scheduler.

This is a deliberate architectural choice: the archivist is infrastructure, not user code. Routing every document scan through the sandbox's tool-call round trips would be prohibitively expensive for what is essentially a batch maintenance pipeline.

### Module Layout

```
src/archivist/
  index.ts          — createArchivist(), start/stop lifecycle (Imperative Shell)
  types.ts          — ArchivistConfig, ArchivistState, StageResult, ChangeSet, BudgetTracker
  pipeline.ts       — runPipeline() orchestrator (Imperative Shell)
  stages/
    scan.ts         — detect changed docs via snapshot comparison (Functional Core)
    dedup.ts        — find and merge near-duplicate documents (Imperative Shell)
    consolidate.ts  — merge archive fragments (Imperative Shell)
    crossref.ts     — add inline markers + create/update index:* docs (Imperative Shell)
    prune.ts        — remove redundant context docs (Functional Core detection, Imperative Shell deletion)
    reflect.ts      — observe patterns, update self and operator (Imperative Shell)
  state.ts          — snapshot persistence and change detection (Functional Core)
  budget.ts         — token usage tracking and soft budget (Functional Core)
```

### Dependencies

```typescript
type ArchivistDependencies = {
  readonly store: Store;
  readonly embedding?: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly config: ArchivistConfig;
};
```

### Dual-Mode Scheduling

Two `croner` timers managed internally:

- **Daytime incremental** (`"0 6-22 * * *"`) — hourly, 6am-10pm. Only processes documents that changed since the last run.
- **Overnight full sweep** (`"0 2 * * *"`) — 2am. Processes all documents regardless of change status.

Timezone from the existing `[agent].timezone` config. Both timers call `runPipeline()` with a mode flag (`incremental` | `full`).

### Pipeline Stages

Six stages run in fixed order. The first three are destructive (merge, delete, rewrite); the last two are constructive (add information). Order matters: dedup reduces the document set before cross-referencing operates on it.

**1. Scan** — Snapshot-based change detection using SHA-256 content hashing. Compares current store state against persisted snapshot in `archivist:state`. Produces a `ChangeSet` (`added`, `modified`, `deleted`, `unchanged` rkey arrays). Filters out immutable prefixes (`ref:*`, `skill:*`, `customtool:*`) from downstream mutation stages.

**2. Dedup** — Two-phase duplicate detection. Embedding pre-filter finds candidate pairs above a cosine similarity threshold (default 0.88). Sub-agent confirms each candidate: "Are these semantically equivalent? Propose merge strategy." Confirmed merges keep the winner with a `<!-- merged-from: loser-rkey, timestamp -->` audit marker; the loser and its chunks are deleted.

**3. Consolidate** — Groups `archive:*` documents by time proximity (same day). Sub-agent synthesizes overlapping conversation snapshots into a single coherent summary. Progressive compression: older consolidated archives get more aggressively summarized on subsequent sweeps.

**4. Cross-reference** — Finds related documents via embedding similarity (threshold ~0.6, lower than dedup). Two outputs: inline HTML comment markers (`<!-- related: rkey1, rkey2 -->`) at the top of each document (idempotent, replaced each run), and `index:*` topic cluster documents listing related docs with a sub-agent-generated summary.

**5. Prune** — Removes documents that add no unique information. Redundancy detection: embedding similarity > 0.92 AND sub-agent confirms the information is a strict subset. Stale context removal: docs not recalled in N runs. Chunk orphan cleanup: `knowledge:name:chunk:*` docs whose parent no longer exists.

**6. Reflect** — The archivist's unique cross-session vantage point. Sub-agent receives a summary of the document store (topic clusters, recent archives, doc counts by prefix) and identifies patterns. Updates archivist-managed sections in `self` (knowledge domains, emerging topics, stale areas) and `operator` (cross-session user patterns, focus shifts, preferences). Only modifies content between `<!-- archivist-managed -->` markers; appends a new section if none exists.

### State Tracking

```typescript
type ArchivistSnapshot = {
  readonly lastRun: string;
  readonly mode: 'incremental' | 'full';
  readonly documents: Record<string, string>;  // rkey → SHA-256 content hash
};
```

Persisted as `archivist:state` document. After each pipeline run, the snapshot is updated with new hashes (including docs the archivist itself modified).

```typescript
type ChangeSet = {
  readonly added: ReadonlyArray<string>;
  readonly modified: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
  readonly unchanged: ReadonlyArray<string>;
};
```

### Budget Tracking

```typescript
type BudgetTracker = {
  readonly limit: number;
  consumed: number;
  readonly breakdown: Record<string, number>;  // stage name → tokens
  shouldContinue(): boolean;
};
```

When `shouldContinue()` returns false (soft limit hit), the pipeline finishes the current in-progress operation, skips remaining stages, and logs what was deferred. Next run picks up unprocessed docs via snapshot detection.

Run summaries appended to `archivist:log` document (rolling, last 30 entries) with scan counts, merge counts, token breakdown by stage, and duration.

### Configuration

New `[archivist]` section in `config.toml`:

```toml
[archivist]
enabled = true
daytime_schedule = "0 6-22 * * *"
nighttime_schedule = "0 2 * * *"
dedup_threshold = 0.88
crossref_threshold = 0.60
token_budget = 0
max_log_entries = 30
```

### Archivist Identity

Stored as `archivist:identity` document. Seeded on first run (same pattern as `seedSelfDoc`). Used as the system prompt for all sub-agent calls the archivist makes.

```markdown
# archivist

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
  - mark everything you write with <!-- archivist-managed --> so it can be identified
```

### Wiring in main()

The archivist is created after store, embedding, and sub-agent are ready, but independently of the agent and scheduler:

```
main() flow:
  1. loadConfig()
  2. createStore()
  3. createEmbeddingProvider()
  4. createSubAgent()
  5. seedSelfDoc(store)
  6. createArchivist({ store, embedding, subAgent, config })  ← NEW
  7. createAgent()
  8. createScheduler()
  9. startInterface (TUI / Discord)
  10. archivist.start()

  on shutdown:
  - archivist.stop()
  - scheduler.stop()
  - store.close()
```

Graceful degradation: no embedding provider → skip dedup and crossref stages. No sub-agent → archivist disabled entirely (logs warning).

No interference with the main agent: the archivist never acquires the chat lock. It talks directly to the store and embedding provider. SQLite handles concurrent access via WAL mode.

### Ref Migration

One-time startup migration via `migrateRefsFromKnowledge(store)`:

1. Check for `<!-- archivist-ref-migration-complete -->` marker in `archivist:state`
2. Scan all `knowledge:*` documents
3. Identify reference books by heuristic: `<!-- source: ... -->` metadata from book-like extensions (`.pdf`, `.epub`) or documents with >10 chunks
4. Create `ref:*` counterparts, delete `knowledge:*` originals, rename chunk documents
5. Mark migration complete

Future ingests use a new `intent: 'reference'` option that writes directly to `ref:*`.

### New Rkey Prefixes

| Prefix | Purpose | Mutable by archivist |
|--------|---------|---------------------|
| `archivist:state` | Snapshot and run state | Yes (owns it) |
| `archivist:identity` | Persona/instructions | No (user-editable) |
| `archivist:log` | Rolling run log | Yes (owns it) |
| `index:*` | Topic cluster documents | Yes (owns them) |
| `ref:*` | Immutable reference documents | No |

## Existing Patterns

Investigation found the following patterns that this design follows:

- **Functional Core / Imperative Shell** annotations on all modules — the archivist follows this convention with scan, state, and budget as Functional Core; pipeline, dedup, consolidate, crossref, reflect as Imperative Shell
- **`readonly` config types** — `ArchivistConfig` and `ArchivistDependencies` use `readonly` throughout
- **One-time seeding pattern** from `seedSelfDoc()` in `src/agent/seed-self-doc.ts` — used for archivist identity seeding and ref migration (check marker → act → set marker)
- **Sub-agent LLM for utility tasks** — same `SubAgentLLM.complete(prompt, system?)` interface used by compaction, session titling, and recall decomposition
- **`croner` for scheduling** — same library used by the scheduler, but the archivist manages its own timer instances
- **Cursor-paginated document listing** — `store.docList(limit, cursor)` for scanning, same pattern used by the agent's document tools
- **HTML comment markers for metadata** — existing pattern from ingest (`<!-- source: ... -->`, `<!-- chunks: ... -->`), extended for archivist markers (`<!-- related: ... -->`, `<!-- merged-from: ... -->`, `<!-- archivist-managed -->`)

No divergence from existing patterns. The archivist introduces a new subsystem category (background maintenance) but follows all established conventions.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types, Configuration, and Scaffold
**Goal:** Establish the archivist module structure, types, and configuration loading.

**Components:**
- `src/archivist/types.ts` — `ArchivistConfig`, `ArchivistDependencies`, `ArchivistSnapshot`, `ChangeSet`, `StageResult`, `BudgetTracker`
- `src/archivist/index.ts` — `createArchivist()` stub returning `{ start(), stop() }`
- `src/archivist/budget.ts` — `createBudgetTracker()` and `shouldContinue()` logic
- `src/archivist/state.ts` — snapshot serialization/deserialization, `computeChangeSet()` pure function
- `src/config/types.ts` — add `ArchivistConfig` to config types
- `src/config/loader.ts` — load `[archivist]` section from `config.toml`

**Dependencies:** None

**Done when:** Types compile, config loads the `[archivist]` section, `createArchivist()` returns the lifecycle interface, `computeChangeSet()` and budget tracker have passing tests
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Scan Stage and State Persistence
**Goal:** Implement snapshot-based change detection and state persistence.

**Components:**
- `src/archivist/stages/scan.ts` — hash all documents, compare against snapshot, produce `ChangeSet`, filter immutable prefixes
- `src/archivist/state.ts` — `loadSnapshot()` and `saveSnapshot()` reading/writing `archivist:state` document

**Dependencies:** Phase 1 (types and config)

**Done when:** Scan detects added, modified, and deleted documents correctly. Snapshot persists across runs. Immutable prefixes are filtered from mutation sets. Tests cover all change detection cases.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Dedup and Prune Stages
**Goal:** Implement the two document-reducing stages.

**Components:**
- `src/archivist/stages/dedup.ts` — embedding pre-filter, sub-agent confirmation, merge execution with audit markers, chunk cleanup
- `src/archivist/stages/prune.ts` — redundancy detection (embedding + sub-agent), stale context removal, chunk orphan cleanup

**Dependencies:** Phase 2 (scan provides ChangeSet input)

**Done when:** Dedup correctly identifies and merges near-duplicate documents with audit trail. Prune removes redundant subsets and orphaned chunks. Both stages respect immutability boundaries. Tests cover merge execution, audit markers, and edge cases (single-doc store, all-immutable store).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Consolidate Stage
**Goal:** Implement archive consolidation with progressive compression.

**Components:**
- `src/archivist/stages/consolidate.ts` — group archives by time proximity, sub-agent synthesis, progressive compression for older archives

**Dependencies:** Phase 2 (scan), Phase 1 (sub-agent dependency)

**Done when:** Archives within the same day are consolidated into single summaries. Older consolidated archives are further compressed on subsequent sweeps. Tests cover grouping logic, single-archive edge case, and progressive compression depth.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Cross-reference Stage
**Goal:** Implement relationship detection, inline markers, and index documents.

**Components:**
- `src/archivist/stages/crossref.ts` — embedding similarity for relationships, inline marker management (idempotent replacement), `index:*` topic cluster creation and incremental update

**Dependencies:** Phase 3 (dedup reduces the set before cross-referencing)

**Done when:** Related documents are linked via inline markers. Index documents are created for topic clusters. Markers are idempotent across runs. Incremental updates add new docs to existing clusters. Tests cover marker format, idempotency, and index document structure.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Reflect Stage
**Goal:** Implement cross-session pattern observation and self/operator updates.

**Components:**
- `src/archivist/stages/reflect.ts` — document store summarization, sub-agent pattern detection, archivist-managed section editing in `self` and `operator`

**Dependencies:** Phase 5 (cross-reference provides topic clusters that inform reflection)

**Done when:** Archivist identifies knowledge domains and user patterns. Archivist-managed sections are created/updated without modifying human/agent content. Guard rails prevent modification outside markers. Tests cover section creation, update, and boundary preservation.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Pipeline Orchestration, Logging, and Wiring
**Goal:** Wire stages into the pipeline, add run logging, and integrate into main().

**Components:**
- `src/archivist/pipeline.ts` — `runPipeline()` orchestrator calling stages in order, passing budget tracker, handling mode flags
- `src/archivist/index.ts` — full `createArchivist()` with croner timers, start/stop lifecycle
- `src/index.ts` — wire archivist into main() dependency graph
- Run logging to `archivist:log` document (rolling, last 30 entries)

**Dependencies:** Phases 1-6 (all stages)

**Done when:** Pipeline runs all stages in order with correct mode behaviour. Budget exhaustion gracefully stops processing. Run logs are written with token breakdown. Archivist starts/stops cleanly in main(). Graceful degradation works (no embedding, no sub-agent).
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Ref Migration and Identity Seeding
**Goal:** One-time migration of reference books and archivist identity seeding.

**Components:**
- `src/archivist/migration.ts` — `migrateRefsFromKnowledge(store)` with marker-based idempotency
- `src/archivist/seed.ts` — seed `archivist:identity` document on first run
- `src/tools/ingest.ts` — add `intent: 'reference'` option writing to `ref:*` prefix

**Dependencies:** Phase 7 (archivist must be wired into main() so migration runs at startup)

**Done when:** Existing reference books migrate from `knowledge:*` to `ref:*` with chunks renamed. Migration is idempotent. Archivist identity seeds on first run. New `intent: 'reference'` option in ingest writes to `ref:*`. Tests cover migration heuristics, idempotency, and the new ingest intent.
<!-- END_PHASE_8 -->

## Additional Considerations

**Concurrent store access:** The archivist and main agent both write to the store concurrently. SQLite WAL mode ensures read consistency. The archivist does not acquire the agent's chat lock — it operates independently. In the unlikely event both write to the same document simultaneously, SQLite's write serialization means one write wins. The archivist's snapshot-based detection will see the agent's write on the next run and process it then. This is acceptable for a background maintenance process.

**Embedding staleness:** When the archivist modifies a document, the existing `getStaleEmbeddings()` mechanism detects the updated `updated_at` timestamp and the background reindexing at startup handles it. The archivist does not need to trigger reindexing itself. However, if the archivist runs between startups, stale embeddings may persist until the next restart. A future improvement could call `reindexEmbeddings()` at the end of each pipeline run.

**Cost visibility:** The soft budget and per-run logging provide cost transparency without enforcement. The `archivist:log` document is readable via the agent's document tools, so the user can ask the main agent "how much has the archivist been spending?" and get a direct answer.
