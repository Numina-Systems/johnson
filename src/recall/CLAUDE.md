# Recall Domain

Last verified: 2026-05-06

## Purpose

Automatically retrieves relevant knowledge from the document store for each user message,
so the agent has contextual awareness without the user re-stating prior knowledge.

## Contracts

- **Exposes**: `performRecall(message, deps) -> RecallResult | null`, `RecallDeps`, `RecallFragment`, `RecallResult`, `DecompositionResult`
- **Guarantees**: Returns null (not error) when guards fail (short message, no embeddings, empty store). Fragments filtered to `knowledge:`, `skill:`, `archive:` prefixes only -- never leaks `self`, `operator`, or `task:*`. Total tokens never exceed `tokenBudget`. Graceful fallback when SubAgentLLM is missing or fails.
- **Expects**: `Store` with `docList` and `docSearch`. `EmbeddingProvider` for semantic search (returns null without one). `SubAgentLLM` optional (falls back to raw message as single query).

## Dependencies

- **Uses**: `store` (docList, docSearch), `embedding` (via hybridSearch in `search/hybrid.ts`), `model/sub-agent` (decomposition), `agent/context` (estimateTokens)
- **Used by**: `agent/agent.ts` (called in `chat()` after compaction, before system prompt build)
- **Boundary**: Does not import from tools, TUI, Discord, or config. Receives dependencies via `RecallDeps` parameter.

## Key Decisions

- Guard-based skip over error: `performRecall` returns null for skip conditions, not exceptions
- Fallback cascade: SubAgentLLM failure -> raw message query; embedding failure -> FTS-only (handled in hybridSearch)
- Prefix allowlist: Prevents recall from surfacing identity (`self`) or user prefs (`operator`) that are already loaded via other paths

## Invariants

- `performRecall` never throws -- all failures produce null or fallback results
- Fragments are always deduplicated by rkey before ranking
- Token budget is enforced via truncation of the last fragment if needed

## Key Files

- `index.ts` - Orchestrator (Imperative Shell): guards, fallback, entry point
- `decompose.ts` - Parser/validator for decomposition JSON (Functional Core)
- `decompose-message.ts` - SubAgentLLM call for decomposition (Imperative Shell)
- `retrieve.ts` - Retrieval pipeline: search, dedupe, filter, rank, trim (Functional Core pure helpers + Imperative Shell retrieveContext)
