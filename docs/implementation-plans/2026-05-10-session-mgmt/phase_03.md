# Session Management Implementation Plan — Phase 3

**Goal:** Create the Imperative Shell module that orchestrates I/O for archiving individual sessions and bulk pruning.

**Architecture:** `src/sessions/archiver.ts` orchestrates the gather-process-persist flow: reads session + messages from Store, optionally generates LLM summary via SubAgentLLM, calls FC functions from Phase 2 to format the archive document, upserts to document store, optionally generates embeddings, and deletes the original session. Both SubAgentLLM and EmbeddingProvider are optional dependencies — archival succeeds without them.

**Tech Stack:** TypeScript, bun:test

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-mgmt.AC3: Archiver orchestrates I/O correctly
- **session-mgmt.AC3.1 Success:** `archiveSession` creates an `archive:session:*` document in the store and deletes the original session
- **session-mgmt.AC3.2 Success:** LLM summary generated only for sessions with >5 messages
- **session-mgmt.AC3.3 Success:** Sessions with ≤5 messages archived without LLM call
- **session-mgmt.AC3.4 Success:** Archival succeeds when SubAgentLLM is unavailable (no summary)
- **session-mgmt.AC3.5 Success:** `pruneSessions` deletes empty stale sessions and archives non-empty stale sessions
- **session-mgmt.AC3.6 Success:** Embedding generated at archival time — summary embedded for >5 msg sessions, full doc for ≤5 msg sessions
- **session-mgmt.AC3.7 Success:** Archival succeeds when EmbeddingProvider is unavailable (no embedding)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/sessions/archiver.ts`

**Files:**
- Create: `src/sessions/archiver.ts`

**Implementation:**

Create the Imperative Shell module with pattern comment `// pattern: Imperative Shell`.

**Imports:**

```typescript
import type { Store } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { ArchiveResult, PruneResult, SessionWithCounts } from './types.ts';
import { loadConversation } from '../agent/messages.ts';
import { buildArchiveRkey, classifySession, formatArchiveDocument } from './archive.ts';
```

**`archiveSession(sessionId, store, subAgent?, embedding?, embeddingModel?)`:**

Signature:

```typescript
export async function archiveSession(
  sessionId: string,
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
  embeddingModel?: string,
): Promise<ArchiveResult>
```

Flow:
1. `store.getSession(sessionId)` — throw if `null`
2. `store.getMessages(sessionId)` — get raw message rows
3. `loadConversation(store, sessionId)` — convert to `Message[]` for `formatConversation`
4. Build `SessionWithCounts` from session data + message count (use `messages.length` and last message's `createdAt`)
5. If `messages.length > 5` and `subAgent` is available: call `subAgent.complete()` with the formatted transcript and a system prompt asking for a concise summary. Wrap in try/catch — on failure, continue without summary (AC3.4).
6. Call `formatArchiveDocument(meta, modelMessages, new Date().toISOString(), summary)` from the FC module
7. Call `buildArchiveRkey(session.title, session.updatedAt)` from the FC module
8. `store.docUpsert(rkey, document)` — save archive document
9. If `embedding` is available: embed the summary (if >5 messages and summary exists) or the full document (if ≤5 messages). Call `embedding.embed(textToEmbed)` then `store.saveEmbedding(rkey, vector, embeddingModel ?? 'nomic-embed-text')`. Wrap in try/catch — on failure, continue (AC3.7).
10. `store.deleteSession(sessionId)` — deletes session and messages
11. Return `{ rkey, title: session.title, messageCount: messages.length }`

The summarization system prompt should be short, e.g.:
```
"You are a conversation summarizer. Given a conversation transcript, produce a concise 2-4 sentence summary of the key topics discussed and any outcomes or decisions."
```

**`pruneSessions(store, subAgent?, embedding?, embeddingModel?, now?)`:**

Signature:

```typescript
export async function pruneSessions(
  store: Store,
  subAgent?: SubAgentLLM,
  embedding?: EmbeddingProvider,
  embeddingModel?: string,
  now?: Date,
): Promise<PruneResult>
```

Flow:
1. `store.listSessionsWithCounts()` — get all sessions with counts
2. For each session, call `classifySession(s.messageCount, s.updatedAt, now ?? new Date())`
3. For sessions classified `"delete"`: call `store.deleteSession(s.id)`, record in details as `{ id, title, action: 'deleted' }`
4. For sessions classified `"archive"`: call `archiveSession(s.id, store, subAgent, embedding, embeddingModel)`, record in details as `{ id, title, action: 'archived', rkey }`
5. Skip sessions classified `"active"`
6. Return `{ deleted: count, archived: count, details }`

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(sessions): add archiver imperative shell`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for `archiver.ts`

**Verifies:** session-mgmt.AC3.1, session-mgmt.AC3.2, session-mgmt.AC3.3, session-mgmt.AC3.4, session-mgmt.AC3.5, session-mgmt.AC3.6, session-mgmt.AC3.7

**Files:**
- Create: `src/sessions/archiver.test.ts`

**Testing:**

Pattern comment: `// pattern: Imperative Shell (test)`

Use the mock Store pattern from `src/agent/agent.test.ts` — build a `createNoopStore()` base and override specific methods to track calls and return test data. The mock store must implement `listSessionsWithCounts` (added in Phase 1).

Create helper functions:
- `createMockStore(sessions, messages)` — returns a store mock that returns specific sessions/messages when queried, and tracks `docUpsert` and `deleteSession` calls
- `createMockSubAgent(response)` — returns a `SubAgentLLM` where `complete()` returns the given string
- `createMockEmbedding()` — returns an `EmbeddingProvider` where `embed()` returns a fixed vector, and tracks calls

Tests must verify each AC listed:

**`archiveSession` tests:**

- **session-mgmt.AC3.1:** Set up a session with 3 messages. Call `archiveSession`. Assert `docUpsert` was called with an rkey matching `archive:session:*`. Assert `deleteSession` was called with the session ID. Assert the returned `ArchiveResult` has the correct rkey and messageCount.

- **session-mgmt.AC3.2:** Set up a session with 8 messages. Provide a mock `subAgent`. Call `archiveSession`. Assert `subAgent.complete` was called (check the mock was invoked). Assert the archive document contains a `## Summary` section.

- **session-mgmt.AC3.3:** Set up a session with 3 messages. Provide a mock `subAgent`. Call `archiveSession`. Assert `subAgent.complete` was NOT called. Assert the archive document does NOT contain a `## Summary` section.

- **session-mgmt.AC3.4:** Set up a session with 8 messages. Do NOT provide `subAgent` (pass `undefined`). Call `archiveSession`. Assert it succeeds (no throw). Assert archive document is created but without `## Summary`. Also test: provide a subAgent that throws, verify archival still succeeds.

- **session-mgmt.AC3.6:** Set up a session with 8 messages. Provide mock `subAgent` and mock `embedding`. Call `archiveSession`. Assert `embedding.embed` was called with the summary text (not the full doc). Then repeat with 3 messages: assert `embedding.embed` was called with the full document content.

- **session-mgmt.AC3.7:** Set up a session with messages. Do NOT provide `embedding`. Call `archiveSession`. Assert it succeeds. Also test: provide an embedding provider that throws, verify archival still succeeds.

**`pruneSessions` tests:**

- **session-mgmt.AC3.5:** Set up mock store with `listSessionsWithCounts` returning:
  - Session A: 0 messages, updatedAt 2 days ago (should be classified `"delete"`)
  - Session B: 10 messages, updatedAt 5 days ago (should be classified `"archive"`)
  - Session C: 3 messages, updatedAt 1 hour ago (should be classified `"active"`, skipped)
  
  Call `pruneSessions` with a fixed `now` date. Assert:
  - Session A was deleted (`deleteSession` called, NOT `docUpsert`)
  - Session B was archived (`docUpsert` called with `archive:session:*` rkey, then `deleteSession`)
  - Session C was not touched
  - Return value has correct `deleted` and `archived` counts

**Verification:**

Run: `bun test src/sessions/archiver.test.ts`
Expected: All tests pass

**Commit:** `test(sessions): add archiver tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
