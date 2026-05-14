# Compaction Session Scoping Design

## Summary

Context compaction is the mechanism the agent uses to manage long conversations: when history grows too large, older messages are serialized to the document store and replaced with a rolling summary. Currently, compaction writes these snapshots under the `archive:` prefix with no session identifier — so every session draws from the same global pool of conversation dumps when rebuilding context. The result is cross-session contamination: a compaction event in one session can pull in conversation history from an unrelated session, and recall (semantic search over memory) surfaces raw conversation dumps instead of useful knowledge.

This change introduces a dedicated `context:<sessionId>:<timestamp>` rkey prefix for compaction snapshots, scoping each session's context archive to its own namespace. The fix is deliberately narrow: `compaction.ts` gains a `sessionId` parameter, the archivist's immutability list gains the `context:` prefix so it never touches these transient snapshots, and a one-time startup migration deletes the now-orphaned `archive:<timestamp>` documents from existing databases. No structural patterns change — the same Functional Core / Imperative Shell split and marker-based idempotent migration pattern already in the codebase are reused as-is.

## Definition of Done

1. Compaction archives use a new prefix (`context:<sessionId>:<timestamp>`) and are scoped per-session — each session only sees its own context history during compaction
2. The archivist continues operating on `archive:session:*` docs as before (it never needed to touch compaction snapshots)
3. Recall stops returning raw conversation dumps (compaction archives leave the `archive:` prefix space, and `context:` is not added to recall's allowlist)
4. Existing orphaned `archive:<timestamp>` compaction docs are cleaned up or ignored

## Acceptance Criteria

### compaction-session-scoping.AC1: Compaction is session-scoped
- **compaction-session-scoping.AC1.1 Success:** Compaction writes documents with rkey `context:<sessionId>:<timestamp>`
- **compaction-session-scoping.AC1.2 Success:** `listContextDocs()` returns only documents matching the current session's prefix
- **compaction-session-scoping.AC1.3 Success:** Two concurrent sessions with different IDs produce independent context archives that do not cross-contaminate
- **compaction-session-scoping.AC1.4 Success:** Summarization in `compactContext()` only processes the current session's older documents
- **compaction-session-scoping.AC1.5 Edge:** When `sessionId` is not provided, compaction uses `"default"` as fallback and operates correctly in its own namespace

### compaction-session-scoping.AC2: Archivist does not modify compaction archives
- **compaction-session-scoping.AC2.1 Success:** `isImmutable()` returns true for `context:*` rkeys
- **compaction-session-scoping.AC2.2 Success:** `filterMutable()` removes `context:*` documents from archivist changesets
- **compaction-session-scoping.AC2.3 Success:** Archivist consolidation (`isArchiveRkey()`) does not match `context:*` rkeys

### compaction-session-scoping.AC3: Orphaned compaction archives are migrated
- **compaction-session-scoping.AC3.1 Success:** Migration deletes `archive:<timestamp>` documents (old compaction format)
- **compaction-session-scoping.AC3.2 Success:** Migration preserves `archive:session:*` documents (session management archives)
- **compaction-session-scoping.AC3.3 Success:** Migration preserves `archive:consolidated:*` documents (archivist consolidations)
- **compaction-session-scoping.AC3.4 Success:** Migration writes marker document at `archivist:compaction-migration`
- **compaction-session-scoping.AC3.5 Success:** Migration is idempotent — subsequent runs are no-ops when marker exists

### compaction-session-scoping.AC4: Documentation is updated
- **compaction-session-scoping.AC4.1 Success:** CLAUDE.md lists `context:<sessionId>:<timestamp>` in rkey prefix documentation
- **compaction-session-scoping.AC4.2 Success:** CLAUDE.md lists `context:*` as an immutable prefix
- **compaction-session-scoping.AC4.3 Success:** CLAUDE.md no longer references `archive:<timestamp>` as a compaction rkey format

## Glossary

- **rkey**: Short for "record key" — the unique string identifier for a document in the agent's flat document store. Follows a `<category>:<qualifier>` naming convention that encodes document type and provides namespace isolation.
- **compaction**: The process of summarising and archiving older conversation history when the context window approaches its token limit. Keeps the active conversation short while preserving a retrievable record of what was discussed.
- **context window**: The fixed maximum amount of text (measured in tokens) that a language model can process in a single request. Conversations that exceed this limit must be compacted or truncated.
- **token**: The unit of text a language model reads. Roughly one word or word fragment. Used throughout the codebase to budget context and estimate document sizes.
- **Functional Core / Imperative Shell (FCIS)**: An architectural pattern that separates pure functions with no side effects (Functional Core) from code that performs I/O, process spawning, or mutation (Imperative Shell). The codebase enforces this split and annotates modules accordingly.
- **archivist**: An autonomous background subsystem that deduplicates and consolidates the agent's document store on a cron schedule. Relevant here because it must not touch compaction snapshots, which are transient rather than durable knowledge.
- **immutable prefix**: A document prefix (e.g., `ref:`, `skill:`) that the archivist is prohibited from modifying. Maintained as a constant array in `src/archivist/state.ts`.
- **recall**: Semantic retrieval that runs before each model call to inject relevant memory fragments into the system prompt. Compaction dumps are intentionally excluded from recall because raw conversation transcripts are not useful as retrieved knowledge.
- **marker-based idempotent migration**: A one-time data migration pattern used in the codebase: a sentinel document is written to the store after migration completes, and future startup runs check for the marker and skip the migration if it already ran.
- **session**: A single conversation thread, identified by a UUID (TUI), channel ID (Discord), or task ID (scheduler). Each session maintains its own message history and, after this change, its own compaction namespace.
- **sub-agent**: A lightweight single-shot LLM call used for utility tasks like summarisation and session titling, without consuming rounds in the main agent tool loop.
- **FTS5**: SQLite's built-in full-text search extension, used for keyword-based document lookup in the store alongside embedding-based semantic search.
- **cosine similarity**: A measure of how similar two embedding vectors are, ranging from -1 to 1. Used by the archivist's dedup stage to find near-duplicate documents.
- **croner**: The in-process cron library used by the scheduler to fire tasks on a time expression or human interval (e.g., `6h`, `30m`).
- **WAL mode**: SQLite's Write-Ahead Logging mode, enabled for the database. Allows concurrent readers while a write is in progress, which matters for multi-session access.

## Architecture

Context compaction currently writes conversation snapshots as `archive:<timestamp>` documents in the global document store with no session affiliation. All sessions read from the same pool, causing cross-session contamination during summarization.

The fix introduces a new `context:` rkey prefix with embedded session identity: `context:<sessionId>:<timestamp>`. Each compaction event writes to and reads from only its own session's namespace. The `archive:` prefix space is left entirely to session management (`archive:session:*`) and archivist consolidation (`archive:consolidated:*`).

**Affected components:**

- **`src/agent/compaction.ts`** — prefix changes from `archive:` to `context:`, gains `sessionId` parameter. `listContextDocs()` filters on `context:<sessionId>:` prefix. `contextRkey()` generates `context:<sessionId>:<timestamp>`.
- **`src/agent/agent.ts`** — threads `options?.sessionId ?? 'default'` into the `compactContext()` call. No structural changes.
- **`src/archivist/state.ts`** — adds `'context:'` to `IMMUTABLE_PREFIXES`. The archivist never modifies transient compaction snapshots.
- **`src/archivist/stages/consolidate.ts`** — no change. `isArchiveRkey()` matches `archive:*` which no longer includes compaction docs.
- **`src/archivist/stages/reflect.ts`** — no change. Archive counts now reflect only session archives, which is more accurate.
- **`src/recall/retrieve.ts`** — no change. `DEFAULT_ALLOWED_PREFIXES` includes `archive:` but not `context:`, so compaction dumps naturally drop out of recall results.
- **Migration** — one-time cleanup of orphaned `archive:<timestamp>` docs (not `archive:session:*` or `archive:consolidated:*`), following the existing marker-based idempotent migration pattern from `src/archivist/migration.ts`.

**Data flow:**

```
chat() call with sessionId
  → needsCompaction() triggers
  → compactContext(history, { store, subAgent, sessionId })
    → store.docUpsert("context:<sessionId>:<timestamp>", conversation)
    → listContextDocs(store, sessionId) — filters on "context:<sessionId>:"
    → summarizeOlderContext() — only this session's archives
    → returns compacted messages
```

**Session ID sources:**
- TUI: session UUID from store
- Discord: channel ID
- Scheduler: `task:<taskId>`
- Fallback: `"default"` when `sessionId` is not provided

## Existing Patterns

**Functional Core / Imperative Shell:** `compactContext` is Imperative Shell (store I/O), `listContextDocs` filtering is pure. This doesn't change — the same split applies with the new `sessionId` parameter.

**Marker-based idempotent migration:** `src/archivist/migration.ts` established the pattern for `knowledge:*` → `ref:*` migration: check for marker document at a fixed rkey, execute mutations if absent, write marker on completion. The compaction migration follows this exact pattern.

**Immutable prefix registration:** `src/archivist/state.ts` maintains `IMMUTABLE_PREFIXES` as a const array. Adding `'context:'` follows the established convention — no new patterns introduced.

**rkey prefix conventions:** The codebase uses `<category>:<qualifier>` consistently (`skill:*`, `ref:*`, `archive:session:*`). The new `context:<sessionId>:<timestamp>` follows this convention with a two-segment qualifier.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Session-Scoped Compaction
**Goal:** Change compaction to write and read session-scoped documents under the `context:` prefix.

**Components:**
- `src/agent/compaction.ts` — change `CONTEXT_PREFIX` to `'context:'`, add `sessionId` parameter to `compactContext()` and `listContextDocs()`, update `contextRkey()` to generate `context:<sessionId>:<timestamp>`
- `src/agent/agent.ts` — pass `sessionId` (with `'default'` fallback) to `compactContext()` call
- `src/agent/compaction.test.ts` — update tests for session-scoped behaviour, add test verifying cross-session isolation

**Dependencies:** None (first phase)

**Done when:** Compaction writes to `context:<sessionId>:<timestamp>`, reads only from the current session's prefix, and tests verify that two sessions with different IDs do not see each other's context archives. Covers `compaction-session-scoping.AC1.*`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Archivist Isolation
**Goal:** Prevent the archivist from modifying compaction archives.

**Components:**
- `src/archivist/state.ts` — add `'context:'` to `IMMUTABLE_PREFIXES`
- `src/archivist/state.test.ts` — add test verifying `isImmutable('context:abc:2026-05-13')` returns true

**Dependencies:** Phase 1

**Done when:** `isImmutable()` returns true for `context:*` rkeys, and `filterMutable()` strips them from changesets. Covers `compaction-session-scoping.AC2.*`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Migration
**Goal:** Clean up orphaned `archive:<timestamp>` compaction documents.

**Components:**
- `src/archivist/migration.ts` — add `migrateCompactionArchives(store)` function following the existing marker-based pattern
- `src/index.ts` — call new migration function during startup alongside `migrateRefsFromKnowledge()`
- Test for migration logic (idempotency, correct filtering of `archive:session:*` and `archive:consolidated:*`)

**Dependencies:** Phase 1, Phase 2

**Done when:** Startup migration deletes orphaned `archive:<timestamp>` docs (not `archive:session:*` or `archive:consolidated:*`), writes marker at `archivist:compaction-migration`, and is idempotent on subsequent runs. Covers `compaction-session-scoping.AC3.*`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Documentation
**Goal:** Update CLAUDE.md to reflect new prefix conventions.

**Components:**
- `CLAUDE.md` — add `context:<sessionId>:<timestamp>` to rkey prefix list, update compaction description, add `context:*` to documented immutable prefixes, remove `archive:<timestamp>` from rkey list

**Dependencies:** Phase 1, Phase 2, Phase 3

**Done when:** CLAUDE.md accurately describes the new compaction prefix, session scoping, and immutability. Covers `compaction-session-scoping.AC4.*`.
<!-- END_PHASE_4 -->

## Additional Considerations

**Recall behaviour change:** Compaction archives previously appeared in recall results via the `archive:` prefix. Moving to `context:` removes them from recall, which is intentional — raw conversation dumps are not useful knowledge for semantic retrieval. Archived sessions (`archive:session:*`) remain in recall and contain more structured, complete conversation records.

**Fallback session ID:** When `sessionId` is not provided (e.g., a hypothetical caller that doesn't set it), compaction uses `"default"` as the session ID. This creates a `context:default:*` namespace that's isolated from named sessions but still functional. All current callers (TUI, Discord, scheduler) provide session IDs.
