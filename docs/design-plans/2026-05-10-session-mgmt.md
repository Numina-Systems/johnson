# Session Management Design

## Summary

Session management adds lifecycle tooling for the conversation sessions that accumulate in the agent's SQLite store over time. Without it, sessions grow unbounded: old, empty, or abandoned conversations stay in the database indefinitely and clutter the TUI. This feature gives both the agent and the user ways to clean house — the agent via sandbox tools it can wire into scheduled tasks, the user via a new interactive prune screen in the TUI.

The approach is a shared archival module (`src/sessions/`) that follows the FC/IS split used everywhere else in the codebase. Pure functions handle slug generation, session classification, and archive document formatting. An imperative shell orchestrates the actual I/O: reading messages from the store, optionally generating an LLM summary for longer sessions, writing the archive document back to the document store (where it becomes searchable via the existing recall system), and deleting the original session. Both the TUI prune screen and the agent sandbox tools call this same archiver, so archival behaves identically regardless of how it's triggered.

## Definition of Done

1. **Store layer**: New methods for listing sessions with message counts in a single query, and for archiving a session (serialize messages → generate conditional summary → store as `archive:session:*` document → delete session).
2. **TUI prune screen**: New screen accessible via keybinding from Sessions screen. Displays all sessions with title, message count, and last active time. Multi-select interface — user picks sessions, hits a key to archive or delete them.
3. **Agent native tool**: `manage_sessions` (or similar) tool that lets the agent list, archive, and delete sessions by criteria (empty, stale, specific IDs). The agent can wire this into scheduled tasks via existing scheduler for auto-archival.
4. **Slug utility**: Small pure function for converting session titles to URL-safe kebab-case slugs.
5. **Archive document format**: Markdown document with metadata header (title, date range, message count) and optionally an LLM-generated summary (for sessions >5 messages), followed by the full message transcript.

## Acceptance Criteria

### session-mgmt.AC1: Store lists sessions with message counts
- **session-mgmt.AC1.1 Success:** `listSessionsWithCounts()` returns sessions with accurate `messageCount` values
- **session-mgmt.AC1.2 Success:** Sessions with 0 messages return `messageCount: 0` and `lastMessageAt: null`
- **session-mgmt.AC1.3 Edge:** Results ordered by `updatedAt DESC`, respects optional `limit` parameter

### session-mgmt.AC2: Pure functions produce correct output
- **session-mgmt.AC2.1 Success:** `slugify("Email Digest")` returns `"email-digest"`
- **session-mgmt.AC2.2 Success:** `slugify(null)` returns `"untitled"`
- **session-mgmt.AC2.3 Edge:** `slugify` strips non-alphanumeric chars, collapses consecutive hyphens, trims leading/trailing hyphens
- **session-mgmt.AC2.4 Success:** `buildArchiveRkey` produces `archive:session:<slug>:<YYYY-MM-DDTHH-MM>` format
- **session-mgmt.AC2.5 Success:** `classifySession` returns `"delete"` for 0-message sessions older than 24h
- **session-mgmt.AC2.6 Success:** `classifySession` returns `"archive"` for sessions with messages but no update in 3 days
- **session-mgmt.AC2.7 Success:** `classifySession` returns `"active"` for recently updated sessions
- **session-mgmt.AC2.8 Success:** `formatArchiveDocument` produces markdown with YAML frontmatter, optional summary, and transcript

### session-mgmt.AC3: Archiver orchestrates I/O correctly
- **session-mgmt.AC3.1 Success:** `archiveSession` creates an `archive:session:*` document in the store and deletes the original session
- **session-mgmt.AC3.2 Success:** LLM summary generated only for sessions with >5 messages
- **session-mgmt.AC3.3 Success:** Sessions with ≤5 messages archived without LLM call
- **session-mgmt.AC3.4 Success:** Archival succeeds when SubAgentLLM is unavailable (no summary)
- **session-mgmt.AC3.5 Success:** `pruneSessions` deletes empty stale sessions and archives non-empty stale sessions
- **session-mgmt.AC3.6 Success:** Embedding generated at archival time — summary embedded for >5 msg sessions, full doc for ≤5 msg sessions
- **session-mgmt.AC3.7 Success:** Archival succeeds when EmbeddingProvider is unavailable (no embedding)

### session-mgmt.AC4: Sandbox tools callable from execute_code
- **session-mgmt.AC4.1 Success:** `tools.list_sessions()` returns all sessions with metadata and classification
- **session-mgmt.AC4.2 Success:** `tools.list_sessions({ filter: "stale" })` returns only stale-classified sessions
- **session-mgmt.AC4.3 Success:** `tools.archive_session({ session_id })` archives and returns the archive rkey
- **session-mgmt.AC4.4 Success:** `tools.delete_session({ session_id })` deletes session and messages

### session-mgmt.AC5: TUI prune screen allows interactive management
- **session-mgmt.AC5.1 Success:** Displays all sessions with title, message count, relative last-active time, classification badge
- **session-mgmt.AC5.2 Success:** `j`/`k` navigates, `space` toggles selection, `a` selects all empty+stale
- **session-mgmt.AC5.3 Success:** `enter` shows confirmation with counts before executing
- **session-mgmt.AC5.4 Success:** Selected sessions with messages are archived; selected empty sessions are deleted
- **session-mgmt.AC5.5 Success:** `escape` returns to Sessions screen without changes
- **session-mgmt.AC5.6 Success:** Screen accessible via `r` keybinding from Sessions screen

## Glossary

- **FC / Functional Core**: A module of pure functions with no side effects or I/O — same input always produces same output. Testable in isolation.
- **IS / Imperative Shell**: A module that orchestrates I/O (database reads/writes, LLM calls, file access). Thin wrapper around FC logic.
- **rkey**: "Record key" — the string identifier for a document in the flat document store. Structured by convention using `:` as a namespace separator (e.g. `archive:session:email-digest:2026-05-10T14-30`).
- **document store**: The agent's key-value memory layer backed by SQLite. Stores skills, notes, archives, and other persistent content as plain markdown, keyed by rkey.
- **SubAgentLLM**: A lightweight single-shot LLM interface used for utility tasks (summarisation, session titling, context compaction) without consuming tool rounds in the main agent loop.
- **EmbeddingProvider**: The configured vector embedding service. Converts text to float vectors stored alongside documents, enabling semantic similarity search.
- **sandbox / `execute_code`**: The Deno subprocess the agent uses as its primary tool. Agent-authored TypeScript runs in this sandbox; tool stubs are generated and injected so sandbox code can call registered tools.
- **sandbox tools**: Tools registered in `sandbox` mode — callable from within `execute_code` via generated TypeScript stubs, not directly by the model.
- **recall**: The system that retrieves semantically relevant document fragments from the store on each `chat()` call and injects them into the system prompt.
- **hybridSearch**: A retrieval function combining FTS5 full-text search and vector similarity to rank documents by relevance.
- **FTS5**: SQLite's built-in full-text search extension, used here for keyword-based document and entity lookups.
- **YAML frontmatter**: Structured metadata block at the top of a markdown document, delimited by `---`, used here to record session title, date range, and message count in archive documents.
- **slug / slugify**: Converting a human-readable title into a URL-safe, lowercase, hyphen-separated string (e.g. `"Email Digest"` → `"email-digest"`).
- **SessionClassification**: A three-value type (`active`, `archive`, `delete`) assigned to each session based on age and message count heuristics.
- **`useInput`**: Ink/React hook for capturing keypress events in the TUI.
- **WAL mode**: SQLite's Write-Ahead Logging mode. Allows concurrent reads during writes — always enabled in this codebase.

## Architecture

Shared archival module following the Functional Core / Imperative Shell pattern used throughout the codebase. Pure formatting, classification, and slug logic lives in an FC module; I/O orchestration (store reads, LLM calls, upserts, deletes) lives in an IS module. Both the TUI prune screen and sandbox tools call the same IS archiver, ensuring consistent behavior.

### Module Structure

```
src/sessions/
  archive.ts      — Functional Core: slugify, rkey construction, classification, document formatting
  archiver.ts     — Imperative Shell: orchestrates archival and pruning I/O
  types.ts        — Shared types (SessionWithCounts, ArchiveResult, PruneResult, SessionClassification)

src/tools/sessions.ts   — Sandbox-mode tool registration (list_sessions, archive_session, delete_session)
src/tui/screens/PruneScreen.tsx — Multi-select archival/deletion screen
```

### Data Flow

**Archival (single session):**
```
TUI or sandbox tool
  → archiver.archiveSession(sessionId, store, subAgent?, embedding?)
    → store.getSession(id) + store.getMessages(id)
    → archive.classifySession(messageCount, updatedAt, now)
    → if messageCount > 5 && subAgent: subAgent.complete(transcript) → summary
    → archive.formatArchiveDocument(meta, messages, archivedAt, summary?)
    → archive.buildArchiveRkey(title, updatedAt) → "archive:session:<slug>:<datetime>"
    → store.docUpsert(rkey, document)
    → if embedding: embed(summary ?? document) → store.saveEmbedding(rkey, emb, model)
    → store.deleteSession(id)
```

**Bulk pruning (agent-driven):**
```
sandbox execute_code
  → tools.list_sessions({ filter: "stale" })
    → store.listSessionsWithCounts()
    → archive.classifySession() per session
  → for each: tools.archive_session({ session_id }) or tools.delete_session({ session_id })
```

The TUI prune screen bypasses sandbox tools and calls `archiver` directly — it's a UI, not a sandbox consumer.

### Archive Document Format

Stored as plain markdown via `docUpsert` with rkey `archive:session:<slug>:<YYYY-MM-DDTHH-MM>`:

```markdown
---
title: Email Digest
archived: 2026-05-10T14:30:00Z
session_date_range: 2026-05-08T09:00:00Z – 2026-05-08T14:30:00Z
message_count: 65
---

## Summary
<LLM-generated summary — only present for sessions with >5 messages>

## Transcript
### user
...
### assistant
...
```

Sessions with ≤5 messages omit the Summary section entirely. The transcript section reuses `formatConversation()` from `src/agent/compaction.ts`.

### Recall Integration

No changes needed. The recall system's `retrieve.ts` filters by prefix using `startsWith('archive:')`, so `archive:session:*` rkeys pass the existing filter. `hybridSearch` searches all documents regardless of prefix; filtering happens downstream.

### Contracts

```typescript
// src/sessions/types.ts

interface SessionWithCounts {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly lastMessageAt: string | null;
}

type SessionClassification = 'delete' | 'archive' | 'active';

interface ArchiveResult {
  readonly rkey: string;
  readonly title: string | null;
  readonly messageCount: number;
}

interface PruneResult {
  readonly deleted: number;
  readonly archived: number;
  readonly details: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly action: 'deleted' | 'archived';
    readonly rkey?: string;
  }>;
}
```

```typescript
// src/sessions/archive.ts — Functional Core exports

function slugify(title: string | null): string;
function buildArchiveRkey(title: string | null, updatedAt: string): string;
function classifySession(messageCount: number, updatedAt: string, now: Date): SessionClassification;
function formatArchiveDocument(
  meta: SessionWithCounts,
  messages: ReadonlyArray<Message>,
  archivedAt: string,
  summary?: string,
): string;
```

```typescript
// src/sessions/archiver.ts — Imperative Shell exports

function archiveSession(
  sessionId: string,
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
): Promise<ArchiveResult>;

function pruneSessions(
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
  now?: Date,
): Promise<PruneResult>;
```

```typescript
// Added to Store interface in src/store/store.ts

listSessionsWithCounts(limit?: number): SessionWithCounts[];
```

## Existing Patterns

### Followed

- **FC/IS separation**: `archive.ts` (FC) and `archiver.ts` (IS) follow the same pattern as `compaction.ts`, `decompose.ts`/`decompose-message.ts`, and `retrieve.ts`. Pattern comments (`// pattern: Functional Core`) will be included.
- **Tool registration**: `registerSessionTools(registry, deps)` follows the same signature and pattern as `registerImageTools`, `registerSummarizeTools`, etc. in `src/tools/`.
- **Store method style**: `listSessionsWithCounts()` follows the prepared statement pattern used by all existing Store methods (prepare at init, run at call time).
- **TUI screen pattern**: `PruneScreen.tsx` follows the component structure, `useInput` hook pattern, and `onSubModeChange` callback used by `ToolsScreen.tsx` and `SessionsScreen.tsx`.
- **Message formatting**: Reuses `formatConversation()` from `src/agent/compaction.ts` for transcript serialization.

### New

- **`src/sessions/` directory**: New module boundary. Existing code doesn't have a `sessions` directory — session logic currently lives in `store.ts` (data) and `SessionsScreen.tsx` (UI). The new directory centralizes archival logic that doesn't belong in either. This follows the pattern of `src/tools/`, `src/recall/`, and `src/secrets/` where domain logic gets its own directory.
- **Slug generation**: No existing utility. Small pure function introduced in `archive.ts`.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Store and Types

**Goal:** Add the `listSessionsWithCounts()` query to the Store and define shared types.

**Components:**
- `src/sessions/types.ts` — `SessionWithCounts`, `SessionClassification`, `ArchiveResult`, `PruneResult` types
- `src/store/store.ts` — `listSessionsWithCounts(limit?)` method added to Store interface and implementation

**Dependencies:** None

**Done when:** `listSessionsWithCounts()` returns sessions with accurate message counts and last message timestamps. Tests verify: sessions with messages return correct counts, sessions with 0 messages return `messageCount: 0` and `lastMessageAt: null`, results ordered by `updatedAt DESC`.

**Covers:** session-mgmt.AC1.1, session-mgmt.AC1.2, session-mgmt.AC1.3
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Functional Core

**Goal:** Pure functions for slug generation, rkey construction, session classification, and archive document formatting.

**Components:**
- `src/sessions/archive.ts` — `slugify()`, `buildArchiveRkey()`, `classifySession()`, `formatArchiveDocument()`

**Dependencies:** Phase 1 (types)

**Done when:** All pure functions produce correct output for representative inputs. Tests verify: slug generation handles null/empty/special characters, rkey format matches `archive:session:<slug>:<datetime>`, classification returns correct category for each heuristic boundary, document formatting produces valid markdown with and without summary section.

**Covers:** session-mgmt.AC2.1, session-mgmt.AC2.2, session-mgmt.AC2.3, session-mgmt.AC2.4, session-mgmt.AC2.5, session-mgmt.AC2.6, session-mgmt.AC2.7, session-mgmt.AC2.8
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Imperative Shell

**Goal:** I/O orchestration for archiving individual sessions and bulk pruning.

**Components:**
- `src/sessions/archiver.ts` — `archiveSession()`, `pruneSessions()`

**Dependencies:** Phase 1 (store, types), Phase 2 (FC functions)

**Done when:** `archiveSession()` creates a correctly formatted archive document in the document store, generates embeddings, deletes the original session, and generates LLM summaries only for sessions with >5 messages. `pruneSessions()` correctly classifies and processes all sessions. Tests verify: archive document appears in store with correct rkey, original session is deleted after archival, SubAgentLLM called only when message count >5, embedding generated (summary for >5 msgs, full doc for ≤5), graceful degradation when SubAgentLLM or EmbeddingProvider unavailable, empty stale sessions are deleted (not archived).

**Covers:** session-mgmt.AC3.1, session-mgmt.AC3.2, session-mgmt.AC3.3, session-mgmt.AC3.4, session-mgmt.AC3.5, session-mgmt.AC3.6, session-mgmt.AC3.7
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Sandbox Tools

**Goal:** Register session management tools callable from `execute_code`.

**Components:**
- `src/tools/sessions.ts` — `registerSessionTools(registry, deps)` with `list_sessions`, `archive_session`, `delete_session`
- `src/agent/tools.ts` — call `registerSessionTools()` from `createAgentTools()`

**Dependencies:** Phase 3 (archiver)

**Done when:** Tools are registered in sandbox mode, TypeScript stubs are generated, and tool handlers correctly delegate to archiver/store. Tests verify: `list_sessions` returns sessions with classification, filter param works, `archive_session` delegates to `archiver.archiveSession()`, `delete_session` delegates to `store.deleteSession()`.

**Covers:** session-mgmt.AC4.1, session-mgmt.AC4.2, session-mgmt.AC4.3, session-mgmt.AC4.4
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: TUI Prune Screen

**Goal:** Multi-select screen for interactive session archival and deletion.

**Components:**
- `src/tui/screens/PruneScreen.tsx` — multi-select list with metadata display, confirmation, and execution
- `src/tui/types.ts` — add `'prune'` to `Screen` type
- `src/tui/App.tsx` — add screen case, wire `'r'` keybinding from Sessions screen navigation

**Dependencies:** Phase 3 (archiver)

**Done when:** Screen displays all sessions with title, message count, last active time, and classification badge. User can navigate, select/deselect, bulk-select empty+stale, execute with confirmation, and return to Sessions screen. Archival calls `archiver.archiveSession()` and deletion calls `store.deleteSession()`.

**Covers:** session-mgmt.AC5.1, session-mgmt.AC5.2, session-mgmt.AC5.3, session-mgmt.AC5.4, session-mgmt.AC5.5, session-mgmt.AC5.6
<!-- END_PHASE_5 -->

## Additional Considerations

**Summary generation failure:** If `SubAgentLLM` is unavailable or fails during archival, the session should still be archived — just without the summary section. The archiver treats summary generation as best-effort, not required.

**`formatConversation` reuse:** The function currently lives in `src/agent/compaction.ts`. If importing it creates an awkward dependency (sessions importing from agent), extract it to a shared utility (e.g., `src/util/format.ts`). Determine at implementation time based on import graph.

**Embedding strategy:** Embeddings are generated at archival time for immediate recall searchability. For sessions with >5 messages, the LLM summary is embedded (semantically dense, better signal). For sessions with ≤5 messages, the full archive document is embedded (short enough to be useful). This matches the pattern used by `ingest_file` (summary for large files, full content for small). Embedding is best-effort — archival succeeds if the EmbeddingProvider is unavailable.
