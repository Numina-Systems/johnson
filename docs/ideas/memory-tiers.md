# Memory Tier Architecture

Adopt Letta's memory tier concepts but implement them within the existing SQLite store.

## Core ideas

- **Core memory**: bounded, always-loaded context (currently `self` and `operator` docs). Make the boundary explicit with size limits and eviction.
- **Archival memory**: long-term storage with semantic search (current documents + embeddings). No change needed structurally, but give the agent explicit tools to move things between tiers.
- **Recall/working memory**: conversation-scoped memory with automatic summarisation (current context compaction). Could be more structured — e.g. a fixed-size working set the agent manages explicitly rather than the current "compact when too big" approach.
- **Memory editing tools**: let the agent update core memory in-place (not just append documents). Letta exposes `core_memory_append`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search` as first-class tools.

## Why not just use Letta directly

- Current store already has FTS5, embeddings, grants/approval layer, and CLI queryability.
- No external service dependency.
- Full control over memory lifecycle and what gets persisted.

## Status

Idea stage. Blocked on completing the current memory-related work first.
