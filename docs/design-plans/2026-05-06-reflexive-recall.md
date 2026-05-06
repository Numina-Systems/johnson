# Reflexive Recall Design

## Summary

Reflexive Recall is an automatic context-retrieval pipeline that fires before every model call. Rather than waiting for the agent to decide it needs to look something up, the system intercepts each incoming user message, decomposes it into semantic search queries and named entities via SubAgentLLM, and retrieves relevant documents from the local store using hybrid search (full-text + vector). The results are injected into the system prompt so the main model sees relevant knowledge, past archive summaries, and skills without ever having to ask for them.

The implementation is entirely local — no external recall service. It slots into the existing agent loop after context compaction, uses infrastructure already present in the codebase (SubAgentLLM, hybridSearch, the document store), and degrades gracefully at each failure point. The feature is off by default behind a config flag and adds roughly 1-3 seconds of latency per turn, which is proportionally small relative to model response time.

## Definition of Done

1. Every turn, before the main model sees user input, the system automatically decomposes the message into semantic queries and named entities, retrieves relevant documents, and injects them into the system prompt.
2. Decomposition uses SubAgentLLM (configurable model) to produce 1-4 semantic queries + named entities from the user message.
3. Retrieval uses existing hybridSearch (FTS5 + vector) for semantic queries and direct FTS lookup for named entities, searching `knowledge:*`, `skill:*`, and `archive:*` documents only.
4. Retrieved context is injected into the system prompt after the self doc section, capped at ~1500 tokens.
5. The system degrades gracefully: SubAgentLLM failure falls back to raw-message single query; embedding failure falls back to FTS-only; empty store produces no injection.
6. Recall runs after context compaction, never triggers compaction itself.
7. Recall is gated behind `recall_enabled` config flag (default false). No new config sections required.
8. A `recall_done` lifecycle event is emitted with timing and fragment count for diagnostics.

## Acceptance Criteria

### reflexive-recall.AC1: Decomposition
- **reflexive-recall.AC1.1 Success:** Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"]
- **reflexive-recall.AC1.2 Success:** Multi-topic message produces 2-4 distinct queries covering each topic
- **reflexive-recall.AC1.3 Edge:** Single-word message produces one query containing that word
- **reflexive-recall.AC1.4 Edge:** Message with no proper nouns produces empty entities array

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

### reflexive-recall.AC7: Prompt Injection
- **reflexive-recall.AC7.1 Success:** Recalled context section appears after self doc, before Available Skills
- **reflexive-recall.AC7.2 Success:** Each fragment rendered with rkey header and content, no score metadata
- **reflexive-recall.AC7.3 Success:** Absent recalledContext produces no section in prompt

### reflexive-recall.AC8: Lifecycle Event
- **reflexive-recall.AC8.1 Success:** recall_done event emitted with elapsed ms and fragment count
- **reflexive-recall.AC8.2 Success:** Event fires even when recall returns zero fragments

### reflexive-recall.AC9: Compaction Ordering
- **reflexive-recall.AC9.1 Success:** Recall runs after compaction check completes
- **reflexive-recall.AC9.2 Success:** Recalled context tokens are not included in compaction threshold estimate

## Glossary

- **SubAgentLLM**: A lightweight single-shot LLM interface used internally for utility tasks (summarization, compaction, session titling). In this context it handles message decomposition. Separate from the main model.
- **hybridSearch**: The existing search function in `src/search/hybrid.ts` that combines FTS5 full-text search with vector (cosine similarity) search, merging results via RRF.
- **FTS5**: SQLite's built-in full-text search extension. Used here for keyword and named-entity lookups against the document store.
- **RRF (Reciprocal Rank Fusion)**: A score-merging algorithm that combines ranked result lists from multiple queries into a single ranked list. Higher RRF score = more consistently relevant across queries.
- **rkey**: The document store's primary key format (e.g. `knowledge:caldav`, `skill:fetch-page`). Prefix conventions (`knowledge:*`, `skill:*`, `archive:*`) determine which documents are eligible for recall.
- **Functional Core / Imperative Shell**: A module design pattern where pure, side-effect-free functions (Functional Core) are kept separate from I/O and orchestration code (Imperative Shell). All modules in this codebase are annotated with which pattern they follow.
- **Context compaction**: The existing mechanism that fires when conversation history exceeds the token budget — it summarises older messages into an `archive:*` document. Recall runs after compaction so it can see freshly written archives.
- **Token budget**: A configurable ceiling (default ~1500 tokens for recall) on how much retrieved content can be injected into the system prompt. Prevents recall from crowding out the rest of the prompt.
- **Decomposition**: The step that converts a raw user message into structured search inputs — semantic queries (short topic phrases) and named entities (proper nouns) — using SubAgentLLM.
- **Fallback cascade**: The ordered sequence of degraded behaviors when components are unavailable: SubAgentLLM failure -> raw message as query; embedding failure -> FTS-only; both down -> FTS on raw message; empty store -> no injection.
- **RecallClient**: A pre-existing client (`src/recall/client.ts`) that was written to talk to an external HTTP recall service. This design replaces that with local-first recall; the client is left in place but unused.
- **Lifecycle event**: Named events (`recall_done`, `llm_start`, etc.) emitted via the `onEvent` callback in the agent loop, used for diagnostics and observability.

## Architecture

Reflexive recall is a pre-turn pipeline that fires automatically before every model call. It removes recall from the agent's decision loop — the agent never chooses to remember; relevant context is already present when it starts reasoning.

Inspired by the [pondsiders reflexive recall architecture](https://pondsiders.github.io/identity/workshop/how-i-persist/), adapted for constellation-lite's existing infrastructure.

### Pipeline

```
user message
    │
    ▼
┌─────────────────────┐
│ SubAgentLLM         │
│ decompose(message)  │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
semantic    named
queries     entities
(1-4)       (0-N)
    │           │
    ▼           ▼
hybridSearch  FTS exact
(per query)   lookup
    │           │
    └─────┬─────┘
          │
    ┌─────┴─────┐
    │ deduplicate │
    │ rank + trim │
    │ to ~1500t   │
    └─────┬─────┘
          │
          ▼
  system prompt
  injection
```

### Components

**Decomposer** (`src/recall/decompose.ts`, Functional Core) — Takes user message text, calls SubAgentLLM with a structured prompt requesting JSON output. Returns semantic queries (1-4 short phrases, 2-6 words each distilling message topics) and named entities (proper nouns for direct lookup). Parsing logic separated from LLM call for testability.

**Retriever** (`src/recall/retrieve.ts`, Functional Core) — Takes decomposition result, runs each semantic query through `hybridSearch()` (limit 5 per query), runs each entity through `store.docSearch()` (limit 3 per entity). Deduplicates by rkey (highest score wins), filters to allowed prefixes (`knowledge:*`, `skill:*`, `archive:*`), ranks by RRF score, and trims to token budget. Truncates individual fragments if needed rather than dropping them entirely.

**Orchestrator** (`src/recall/index.ts`, Imperative Shell) — `performRecall()` wires decomposition and retrieval together. Handles guard conditions (skip on empty message, missing dependencies, very short input). Manages the fallback cascade. This is what `chat()` calls.

**System prompt injection** — `buildSystemPrompt()` in `src/agent/context.ts` gains an optional `recalledContext` parameter. When present, a `## Recalled Context` section is inserted after the self doc and before Available Skills. Each fragment rendered as `### [rkey]\ncontent`. No metadata exposed to the model.

### Contracts

```typescript
// src/recall/decompose.ts

type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};

function decomposeMessage(
  message: string,
  subAgent: SubAgentLLM,
): Promise<DecompositionResult>;

function parseDecompositionResponse(
  raw: string,
): DecompositionResult;
```

```typescript
// src/recall/retrieve.ts

type RecallFragment = {
  readonly rkey: string;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
};

type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};

function retrieveContext(
  decomposition: DecompositionResult,
  deps: HybridSearchDeps,
  tokenBudget: number,
  allowedPrefixes: ReadonlyArray<string>,
): Promise<RecallResult>;
```

```typescript
// src/recall/index.ts

type RecallDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider;
  readonly subAgent: SubAgentLLM;
  readonly tokenBudget: number;
};

function performRecall(
  message: string,
  deps: RecallDeps,
): Promise<RecallResult | null>;
```

### Data Flow in Agent Loop

Position in `chat()` (src/agent/agent.ts):

1. User message appended to history *(existing)*
2. Repair orphaned tool_use blocks + trim old results *(existing)*
3. Compaction check — if over budget, compact *(existing)*
4. **Recall step** *(new)*
   - Extract text from user message
   - `performRecall(text, recallDeps)`
   - Rebuild system prompt with `recalledContext`
5. Tool loop begins — model sees enriched prompt *(existing)*

### Guard Conditions

Recall is skipped (returns null) when:
- `recallEnabled` is false in config
- No embedding provider configured
- User message is empty or < 10 characters
- Document store has zero searchable documents

When SubAgentLLM is unavailable but embeddings work, decomposition is skipped and the raw message is used as a single hybridSearch query (fallback to direct embed approach).

### Fallback Cascade

| Failure | Behavior |
|---------|----------|
| SubAgentLLM unavailable | Skip decomposition, raw message as single hybridSearch query |
| SubAgentLLM returns malformed JSON | Same — fall back to raw message single query |
| Embedding provider unavailable | hybridSearch degrades to FTS-only (existing behavior) |
| Both SubAgentLLM and embeddings down | FTS search on raw message |
| Store has no documents | Recall returns null, no section injected |

## Existing Patterns

Investigation found the following patterns this design follows:

- **Functional Core / Imperative Shell** — All modules in `src/` are annotated with their pattern. Decomposition and retrieval are pure (Functional Core). Orchestration is Imperative Shell. Follows convention from `src/search/hybrid.ts`, `src/agent/context.ts`.
- **SubAgentLLM usage** — Same `complete(prompt, system)` pattern used in `src/agent/compaction.ts`, `src/agent/session-title.ts`, and `src/tools/summarize.ts`.
- **Hybrid search** — `src/search/hybrid.ts` already implements FTS5 + vector + RRF merging. Retrieval reuses this directly rather than reimplementing search.
- **System prompt assembly** — `buildSystemPrompt()` in `src/agent/context.ts` assembles sections in order. Adding a recall section follows the existing pattern of `sections.push()`.
- **Graceful degradation** — Existing embedding and search code handles unavailable providers without throwing. Recall follows the same pattern.
- **Config** — Embedding and sub-model configs are optional in `AppConfig`. Recall config fields follow the same optional pattern.

Divergence from existing code: the `src/recall/client.ts` RecallClient was built as a client for an external HTTP recall service (committed 2026-05-03). This design replaces that approach with local-first recall. The existing RecallClient is left in place but unused — it can serve as an alternative backend in the future.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Decomposition Module

**Goal:** Parse user messages into semantic queries and named entities via SubAgentLLM.

**Components:**
- `src/recall/decompose.ts` (Functional Core) — `decomposeMessage()` and `parseDecompositionResponse()` functions, `DecompositionResult` type
- `src/recall/decompose.test.ts` — Unit tests for JSON parsing (valid, malformed, edge cases) and integration tests with mocked SubAgentLLM

**Dependencies:** None (uses existing SubAgentLLM interface)

**Covers:** reflexive-recall.AC1 (decomposition), reflexive-recall.AC5 (SubAgentLLM fallback)

**Done when:** `parseDecompositionResponse()` correctly extracts queries and entities from valid JSON, returns sensible fallback from malformed input. `decomposeMessage()` calls SubAgentLLM and parses the response. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Retrieval Pipeline

**Goal:** Multi-query search with deduplication, prefix filtering, and token-budgeted ranking.

**Components:**
- `src/recall/retrieve.ts` (Functional Core) — `retrieveContext()` function, `RecallFragment` and `RecallResult` types
- `src/recall/retrieve.test.ts` — Unit tests for deduplication logic, rkey prefix filtering, token budget enforcement, score ranking, fragment truncation

**Dependencies:** Phase 1 (consumes `DecompositionResult`), existing `hybridSearch` and `Store`

**Covers:** reflexive-recall.AC2 (retrieval), reflexive-recall.AC3 (prefix filtering), reflexive-recall.AC4 (token budget)

**Done when:** Retrieval produces ranked, deduplicated, budget-trimmed fragments from mock store data. Entity lookups and semantic queries merged correctly. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Orchestrator and Fallback Cascade

**Goal:** Wire decomposition and retrieval into a single `performRecall()` entry point with guard conditions and fallback behavior.

**Components:**
- `src/recall/index.ts` (Imperative Shell) — `performRecall()` function, `RecallDeps` type
- `src/recall/index.test.ts` — Integration tests for full pipeline with mocked dependencies, fallback cascade (SubAgentLLM failure, embedding failure, both down, empty store), guard conditions (short messages, disabled config)

**Dependencies:** Phase 1, Phase 2

**Covers:** reflexive-recall.AC5 (fallback cascade), reflexive-recall.AC6 (guard conditions)

**Done when:** `performRecall()` returns correct results with all deps available, degrades correctly through each fallback level, returns null when guards trigger. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: System Prompt Injection

**Goal:** Inject recalled context into the system prompt at the correct position.

**Components:**
- `src/agent/context.ts` — Extend `buildSystemPrompt()` with optional `recalledContext` parameter, render `## Recalled Context` section after self doc
- `src/agent/context.test.ts` — Extend existing tests to verify section positioning, absent when empty/undefined, correct rendering of fragments

**Dependencies:** Phase 2 (uses `RecallResult` type)

**Covers:** reflexive-recall.AC7 (prompt injection position), reflexive-recall.AC4.3 (no injection when empty)

**Done when:** System prompt contains recalled context section in correct position when provided, omits it when absent. Existing tests still pass. All new tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Agent Loop Integration

**Goal:** Wire recall into `chat()` flow and emit lifecycle events.

**Components:**
- `src/agent/agent.ts` — Add recall step after compaction check, before tool loop. Extract user message text, call `performRecall()`, rebuild system prompt with result
- `src/agent/types.ts` — Add `recallEnabled` boolean to `AgentDependencies`
- `src/config/types.ts` — Add `recallEnabled` and `recallTokenBudget` fields to `AgentLoopConfig`
- `src/config/loader.ts` — Load new config fields from `[agent]` section
- `src/index.ts` — Wire `recallEnabled` from config into agent dependencies

**Dependencies:** Phase 3, Phase 4

**Covers:** reflexive-recall.AC8 (lifecycle event), reflexive-recall.AC6.1 (disabled by default), reflexive-recall.AC9 (runs after compaction)

**Done when:** With `recall_enabled = true`, recall fires before model call and injects context. With `recall_enabled = false` (default), recall is skipped entirely. `recall_done` event emitted with timing and fragment count. Existing agent tests unaffected. Build succeeds.
<!-- END_PHASE_5 -->

## Additional Considerations

**Scaling:** `hybridSearch()` loads all embeddings into memory for brute-force cosine similarity. This works for the current document corpus size but won't scale past ~10K documents. If the store grows significantly, vector search should move to an indexed approach (e.g., HNSW). This is a known limitation of the existing search infrastructure, not specific to recall.

**Latency observation:** The recall step adds 1-3 seconds to every turn. Since the main model call typically takes 5-30 seconds, this is proportionally small. If latency becomes a concern, the tiered approach (direct embed first, decompose only when needed) was explored in brainstorming as a future optimization.

**Existing RecallClient:** `src/recall/client.ts` and its tests remain untouched. If an external recall service is later deployed, `performRecall()` could be extended to delegate to it instead of local search, selected by config.
