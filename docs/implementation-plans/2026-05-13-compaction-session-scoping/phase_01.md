# Compaction Session Scoping Implementation Plan — Phase 1

**Goal:** Change compaction to write and read session-scoped documents under the `context:` prefix instead of the global `archive:` prefix.

**Architecture:** The compaction module (`src/agent/compaction.ts`) currently stores conversation snapshots under `archive:<timestamp>`, shared across all sessions. This phase changes the prefix to `context:<sessionId>:<timestamp>`, adds a `sessionId` parameter to the compaction functions, and threads `sessionId` from `ChatOptions` through `agent.ts` into `compactContext()`. The scheduler is also updated to pass `sessionId` in its `agent.chat()` call (currently missing).

**Tech Stack:** TypeScript, bun:test, SQLite (via `src/store/store.ts`)

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-05-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-session-scoping.AC1: Compaction is session-scoped
- **compaction-session-scoping.AC1.1 Success:** Compaction writes documents with rkey `context:<sessionId>:<timestamp>`
- **compaction-session-scoping.AC1.2 Success:** `listContextDocs()` returns only documents matching the current session's prefix
- **compaction-session-scoping.AC1.3 Success:** Two concurrent sessions with different IDs produce independent context archives that do not cross-contaminate
- **compaction-session-scoping.AC1.4 Success:** Summarization in `compactContext()` only processes the current session's older documents
- **compaction-session-scoping.AC1.5 Edge:** When `sessionId` is not provided, compaction uses `"default"` as fallback and operates correctly in its own namespace

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Update compaction prefix and add sessionId parameter

**Verifies:** compaction-session-scoping.AC1.1, compaction-session-scoping.AC1.2, compaction-session-scoping.AC1.5

**Files:**
- Modify: `src/agent/compaction.ts:15-66` (constant, `contextRkey`, `listContextDocs`, `compactContext` signature)

**Implementation:**

Apply the following changes to `src/agent/compaction.ts`:

1. Update the file header comment (lines 1-7) to reference the new prefix. Change `archive:<timestamp>` to `context:<sessionId>:<timestamp>` in the comment on line 4:

```typescript
// pattern: Imperative Shell — context compaction via SQLite store
//
// When conversation token count exceeds contextBudget × contextLimit:
// 1. Save full conversation to store as context:<sessionId>:<timestamp> document
// 2. Load the 2-3 most recent context documents for this session (full text)
// 3. Summarize all older context documents into one paragraph
// 4. Return rebuilt context for the agent to continue with
```

2. Change the `CONTEXT_PREFIX` constant (line 15) from `'archive:'` to `'context:'`.

3. Update `contextRkey()` (lines 51-55) to accept a `sessionId` parameter and embed it in the rkey:

```typescript
function contextRkey(sessionId: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${CONTEXT_PREFIX}${sessionId}:${ts}`;
}
```

4. Update `listContextDocs()` (lines 60-66) to accept a `sessionId` parameter and filter on the session-scoped prefix:

```typescript
function listContextDocs(store: Store, sessionId: string): Array<{ rkey: string; content: string }> {
  const prefix = `${CONTEXT_PREFIX}${sessionId}:`;
  const result = store.docList(500);
  return result.documents
    .filter((d) => d.rkey.startsWith(prefix))
    .sort((a, b) => a.rkey.localeCompare(b.rkey))
    .map((d) => ({ rkey: d.rkey, content: d.content }));
}
```

**Note:** `listContextDocs` uses `store.docList(500)` then filters client-side by prefix. The store's `docList()` API has no prefix filter parameter — this is the existing pattern. With session scoping, the unfiltered pool now includes documents from all sessions, but the design explicitly states "no structural patterns change." This is a known trade-off; a future optimization (e.g., prefix-based query) could help if document count grows significantly.

5. Update `compactContext()` (lines 122-128) to accept an optional `sessionId` in the deps object, defaulting to `'default'`:

```typescript
export async function compactContext(
  messages: ReadonlyArray<Message>,
  deps: {
    store: Store;
    subAgent: SubAgentLLM;
    sessionId?: string;
  },
): Promise<Array<Message>> {
  const sid = deps.sessionId ?? 'default';

  // 1. Save current conversation
  const rkey = contextRkey(sid);
  const conversationText = formatConversation(messages);
  deps.store.docUpsert(rkey, conversationText);

  // 2. Load all context documents for THIS session (sorted oldest→newest)
  const allDocs = listContextDocs(deps.store, sid);

  // ... rest unchanged from line 138 onward
```

The body of `compactContext` from line 138 onward (splitting into recent/older, summarization, building the compaction message) remains unchanged — it already operates on `allDocs` which is now session-scoped.

**Verification:**

Run: `bun run build`
Expected: Builds without errors

**Commit:** `feat(compaction): scope context documents to session via context: prefix`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for session-scoped compaction

**Verifies:** compaction-session-scoping.AC1.1, compaction-session-scoping.AC1.2, compaction-session-scoping.AC1.3, compaction-session-scoping.AC1.4, compaction-session-scoping.AC1.5

**Files:**
- Modify: `src/agent/compaction.test.ts` (update existing tests, add new tests)

**Implementation:**

The existing test file at `src/agent/compaction.test.ts` uses manual mock factories (`makeMockStore`, `makeMockSubAgent`) and `bun:test`. Update it as follows:

1. **Update existing test data** in the `compactContext` describe block. The two existing tests use `archive:` prefixed rkeys in their mock documents. Update these to use `context:<sessionId>:` format since `listContextDocs` now filters on `context:<sessionId>:`.

For the first test ("uses sub-agent for summarization when older context docs exist"), change the documents array to use a consistent sessionId (e.g., `'session-1'`) and the `context:` prefix:

```typescript
const documents = [
  { rkey: 'context:session-1:2025-01-01T00-00-00', content: 'conversation 1' },
  { rkey: 'context:session-1:2025-01-02T00-00-00', content: 'conversation 2' },
  { rkey: 'context:session-1:2025-01-03T00-00-00', content: 'conversation 3' },
  { rkey: 'context:session-1:2025-01-04T00-00-00', content: 'conversation 4' },
  { rkey: 'context:session-1:2025-01-05T00-00-00', content: 'conversation 5' },
];
```

And pass `sessionId` in the deps:

```typescript
const result = await compactContext(messages, { store, subAgent, sessionId: 'session-1' });
```

Apply the same pattern to the second test ("skips sub-agent call when there are no older context docs to summarize").

2. **Add a test for AC1.1** — verify the upserted rkey matches `context:<sessionId>:<timestamp>`:

```typescript
test('writes context document with session-scoped rkey', async () => {
  const { store, upserts } = makeMockStore([]);
  const { subAgent } = makeMockSubAgent('summary');
  const messages: Message[] = [{ role: 'user', content: 'hello' }];

  await compactContext(messages, { store, subAgent, sessionId: 'test-session' });

  expect(upserts.length).toBeGreaterThanOrEqual(1);
  expect(upserts[0]!.rkey).toMatch(/^context:test-session:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
});
```

3. **Add a test for AC1.3** — cross-session isolation:

```typescript
test('sessions do not see each other\'s context documents', async () => {
  const sessionADocs = [
    { rkey: 'context:session-a:2025-01-01T00-00-00', content: 'session A conversation' },
    { rkey: 'context:session-a:2025-01-02T00-00-00', content: 'session A conversation 2' },
    { rkey: 'context:session-a:2025-01-03T00-00-00', content: 'session A conversation 3' },
    { rkey: 'context:session-a:2025-01-04T00-00-00', content: 'session A conversation 4' },
  ];
  const sessionBDocs = [
    { rkey: 'context:session-b:2025-01-01T00-00-00', content: 'session B conversation' },
    { rkey: 'context:session-b:2025-01-02T00-00-00', content: 'session B conversation 2' },
    { rkey: 'context:session-b:2025-01-03T00-00-00', content: 'session B conversation 3' },
    { rkey: 'context:session-b:2025-01-04T00-00-00', content: 'session B conversation 4' },
  ];

  // Test session-a isolation
  const { store: storeA, upserts: upsertsA } = makeMockStore([...sessionADocs, ...sessionBDocs]);
  const { subAgent: subAgentA } = makeMockSubAgent('summary A');

  const messagesA: Message[] = [{ role: 'user', content: 'hello from A' }];
  const resultA = await compactContext(messagesA, { store: storeA, subAgent: subAgentA, sessionId: 'session-a' });

  const compactionContentA = resultA[0]!.content as string;
  expect(compactionContentA).not.toContain('session B conversation');
  expect(upsertsA[0]!.rkey).toStartWith('context:session-a:');

  // Test session-b isolation (bidirectional verification)
  const { store: storeB, upserts: upsertsB } = makeMockStore([...sessionADocs, ...sessionBDocs]);
  const { subAgent: subAgentB } = makeMockSubAgent('summary B');

  const messagesB: Message[] = [{ role: 'user', content: 'hello from B' }];
  const resultB = await compactContext(messagesB, { store: storeB, subAgent: subAgentB, sessionId: 'session-b' });

  const compactionContentB = resultB[0]!.content as string;
  expect(compactionContentB).not.toContain('session A conversation');
  expect(upsertsB[0]!.rkey).toStartWith('context:session-b:');
});
```

4. **Add a test for AC1.5** — default sessionId fallback:

```typescript
test('uses "default" session when sessionId is not provided', async () => {
  const { store, upserts } = makeMockStore([]);
  const { subAgent } = makeMockSubAgent('summary');
  const messages: Message[] = [{ role: 'user', content: 'hello' }];

  await compactContext(messages, { store, subAgent });

  expect(upserts.length).toBeGreaterThanOrEqual(1);
  expect(upserts[0]!.rkey).toStartWith('context:default:');
});
```

**Testing:**

Tests must verify each AC listed above:
- compaction-session-scoping.AC1.1: Upserted rkey matches `context:<sessionId>:<timestamp>` format
- compaction-session-scoping.AC1.2: `listContextDocs` filters by session prefix (verified implicitly — compaction output only contains the session's own documents)
- compaction-session-scoping.AC1.3: Cross-session isolation — session A's compaction does not include session B's documents
- compaction-session-scoping.AC1.4: Summarization only processes current session's older documents (verified by the existing sub-agent call test, updated with session-scoped data)
- compaction-session-scoping.AC1.5: Missing sessionId defaults to `'default'` namespace

Follow project testing patterns: `bun:test`, manual mock factories (`makeMockStore`, `makeMockSubAgent`), pattern marker `// pattern: Functional Core (test)`.

**Verification:**

Run: `bun test src/agent/compaction.test.ts`
Expected: All tests pass

**Commit:** `test(compaction): add session-scoped compaction tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Thread sessionId from agent.ts into compactContext

**Verifies:** compaction-session-scoping.AC1.1

**Files:**
- Modify: `src/agent/agent.ts:177-182` (compactContext call site)

**Implementation:**

At `src/agent/agent.ts:179`, the `compactContext()` call currently passes only `{ store, subAgent }`. Add `sessionId` from `options?.sessionId`:

```typescript
const compacted = await compactContext(history, {
  store: deps.store,
  subAgent: deps.subAgent,
  sessionId: options?.sessionId,
});
```

The `ChatOptions` type at `src/agent/types.ts:89` already includes `readonly sessionId?: string;`, so no type changes are needed. When `sessionId` is undefined (not provided), `compactContext` will fall back to `'default'` as implemented in Task 1.

**Verification:**

Run: `bun run build`
Expected: Builds without errors

Run: `bun test src/agent/`
Expected: All agent tests pass

**Commit:** `feat(agent): pass sessionId to compactContext`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Pass sessionId in scheduler's agent.chat() call

**Verifies:** compaction-session-scoping.AC1.1

**Files:**
- Modify: `src/scheduler/scheduler.ts:207-210` (agent.chat call)

**Implementation:**

At `src/scheduler/scheduler.ts:207-210`, the scheduler calls `deps.agent.chat()` without passing `sessionId`:

```typescript
// Current (line 207-210):
const result = await deps.agent.chat(prompt, {
  context,
  conversationOverride: history,
});
```

Add `sessionId` to the options:

```typescript
const result = await deps.agent.chat(prompt, {
  context,
  conversationOverride: history,
  sessionId,
});
```

The `sessionId` variable is already defined at line 192 as `` `task:${live.state.id}` ``, so it's in scope.

**Verification:**

Run: `bun run build`
Expected: Builds without errors

**Commit:** `fix(scheduler): pass sessionId to agent.chat for compaction scoping`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
