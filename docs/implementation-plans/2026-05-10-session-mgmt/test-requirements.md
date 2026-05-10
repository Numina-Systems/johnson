# Test Requirements: Session Management

Maps every acceptance criterion to either an automated test or a documented human verification approach.

**Conventions:**
- FC tests are pure input/output assertions (no mocks, no I/O)
- IS tests use mock Store/SubAgentLLM/EmbeddingProvider
- TUI tests are manual (ink-testing-library is not in the project)
- Test files live alongside source files

---

## Automated Tests

### session-mgmt.AC1: Store lists sessions with message counts

| Criterion | Test Type | Test File | Verification |
|-----------|-----------|-----------|--------------|
| AC1.1 | integration | `src/store/store.test.ts` | Create a session, append N messages via `addMessage()`, call `listSessionsWithCounts()`. Assert returned `messageCount` equals N. |
| AC1.2 | integration | `src/store/store.test.ts` | Create a session with no messages. Call `listSessionsWithCounts()`. Assert `messageCount` is `0` and `lastMessageAt` is `null`. |
| AC1.3 | integration | `src/store/store.test.ts` | Create multiple sessions with staggered `updatedAt` timestamps. Assert results are ordered by `updatedAt` DESC. Call with `limit: 1` and assert only one result returned. |

**Notes:** Uses `createStore(":memory:")` for in-memory SQLite -- tests real query behaviour without temp file cleanup. This is the first test file for the Store module.

---

### session-mgmt.AC2: Pure functions produce correct output

| Criterion | Test Type | Test File | Verification |
|-----------|-----------|-----------|--------------|
| AC2.1 | unit (FC) | `src/sessions/archive.test.ts` | `slugify("Email Digest")` returns `"email-digest"`. |
| AC2.2 | unit (FC) | `src/sessions/archive.test.ts` | `slugify(null)` returns `"untitled"`. |
| AC2.3 | unit (FC) | `src/sessions/archive.test.ts` | `slugify("---Hello!! World---")` strips non-alphanumeric chars, collapses consecutive hyphens, trims leading/trailing hyphens. Also: `slugify("")` returns `"untitled"`. |
| AC2.4 | unit (FC) | `src/sessions/archive.test.ts` | `buildArchiveRkey("Email Digest", "2026-05-10T14:30:00Z")` returns `"archive:session:email-digest:2026-05-10T14-30"`. Also: `buildArchiveRkey(null, ...)` uses `"untitled"` slug. |
| AC2.5 | unit (FC) | `src/sessions/archive.test.ts` | `classifySession(0, updatedAt25hAgo, now)` returns `"delete"`. Boundary: `classifySession(0, updatedAt23hAgo, now)` returns `"active"`. |
| AC2.6 | unit (FC) | `src/sessions/archive.test.ts` | `classifySession(10, updatedAt4dAgo, now)` returns `"archive"`. Boundary: `classifySession(10, updatedAt2dAgo, now)` returns `"active"`. |
| AC2.7 | unit (FC) | `src/sessions/archive.test.ts` | `classifySession(5, updatedAt1hAgo, now)` returns `"active"`. |
| AC2.8 | unit (FC) | `src/sessions/archive.test.ts` | Call `formatArchiveDocument()` with a `SessionWithCounts`, message array, fixed `archivedAt`, and a summary string. Assert output contains `---` YAML frontmatter delimiters, `title`, `archived`, `session_date_range`, `message_count`, a `## Summary` section, and a `## Transcript` section. Second test: omit summary, assert `## Summary` absent but `## Transcript` present. |

**Notes:** Pure FC tests -- no mocks, no I/O. All dates are fixed literals for deterministic assertions.

---

### session-mgmt.AC3: Archiver orchestrates I/O correctly

| Criterion | Test Type | Test File | Verification |
|-----------|-----------|-----------|--------------|
| AC3.1 | integration | `src/sessions/archiver.test.ts` | Set up a session with 3 messages via mock store. Call `archiveSession()`. Assert `docUpsert` called with rkey matching `archive:session:*`. Assert `deleteSession` called with session ID. Assert returned `ArchiveResult` has correct rkey and messageCount. |
| AC3.2 | integration | `src/sessions/archiver.test.ts` | Set up a session with 8 messages. Provide mock `subAgent`. Call `archiveSession()`. Assert `subAgent.complete` was invoked. Assert archive document contains `## Summary`. |
| AC3.3 | integration | `src/sessions/archiver.test.ts` | Set up a session with 3 messages. Provide mock `subAgent`. Call `archiveSession()`. Assert `subAgent.complete` was NOT called. Assert archive document does NOT contain `## Summary`. |
| AC3.4 | integration | `src/sessions/archiver.test.ts` | Two sub-tests: (a) Pass `undefined` for `subAgent` with 8 messages -- assert archival succeeds without summary. (b) Provide a `subAgent` that throws -- assert archival still succeeds without summary. |
| AC3.5 | integration | `src/sessions/archiver.test.ts` | Mock store returns 3 sessions from `listSessionsWithCounts`: empty+stale (2d old, 0 msgs), non-empty+stale (5d old, 10 msgs), active (1h old, 3 msgs). Call `pruneSessions(store, subAgent, embedding, model, fixedNow)`. Assert: empty session deleted (not archived), stale session archived (docUpsert + deleteSession), active session untouched. Return value has correct `deleted` and `archived` counts. |
| AC3.6 | integration | `src/sessions/archiver.test.ts` | Two sub-tests: (a) 8-message session with mock `subAgent` and mock `embedding` -- assert `embedding.embed` called with summary text. (b) 3-message session with mock `embedding` -- assert `embedding.embed` called with full document content. |
| AC3.7 | integration | `src/sessions/archiver.test.ts` | Two sub-tests: (a) Pass `undefined` for `embedding` -- assert archival succeeds. (b) Provide an `embedding` that throws -- assert archival still succeeds. |

**Notes:** IS tests using mock Store (tracking `docUpsert`/`deleteSession` calls), mock SubAgentLLM, and mock EmbeddingProvider. Follows the `createNoopStore()` override pattern from `src/agent/agent.test.ts`.

---

### session-mgmt.AC4: Sandbox tools callable from execute_code

| Criterion | Test Type | Test File | Verification |
|-----------|-----------|-----------|--------------|
| AC4.1 | integration | `src/tools/sessions.test.ts` | Register tools via `registerSessionTools(registry, mockDeps)`. Call `registry.execute('list_sessions', {})`. Assert returns all sessions from mock store, each with a `classification` field computed correctly (old empty = `"delete"`, old with messages = `"archive"`, recent = `"active"`). |
| AC4.2 | integration | `src/tools/sessions.test.ts` | Set up mock store with sessions of different classifications. Call `registry.execute('list_sessions', { filter: 'stale' })`. Assert only sessions classified `"delete"` or `"archive"` are returned. Active sessions excluded. |
| AC4.3 | integration | `src/tools/sessions.test.ts` | Call `registry.execute('archive_session', { session_id: 'test-id' })`. Assert mock store's `docUpsert` was called (archive doc created). Assert `deleteSession` was called. Assert return value contains the rkey. |
| AC4.4 | integration | `src/tools/sessions.test.ts` | Call `registry.execute('delete_session', { session_id: 'test-id' })`. Assert `deleteSession` called on mock store with `'test-id'`. Assert return value confirms deletion. Also: mock `deleteSession` returning `false` -- assert it throws. |

**Notes:** Uses a real `ToolRegistry` (via `createToolRegistry()`) with mock `AgentDependencies`. Follows the pattern established by `src/tools/web.test.ts`, `src/tools/image.test.ts`, etc.

---

## Human Verification

### session-mgmt.AC5: TUI prune screen allows interactive management

| Criterion | Justification | Verification Approach |
|-----------|---------------|----------------------|
| AC5.1 | Ink/React rendering requires ink-testing-library (not in project); visual layout verification needs human eyes | Run `bun start`. Navigate to Sessions screen, press `r`. Visually confirm each session row shows: title (or "Untitled session"), message count in `(N msgs)` format, relative last-active time, and a classification badge (`[delete]`, `[archive]`, or `[active]`) in appropriate colours. |
| AC5.2 | Keyboard interaction testing requires ink-testing-library for simulating keypresses in a virtual terminal | From Prune Screen: press `j`/`k` to move cursor, confirm highlight moves. Press `space` to toggle selection, confirm checkbox toggles. Press `a`, confirm all sessions classified as `"delete"` or `"archive"` become selected. |
| AC5.3 | Confirmation dialog is a modal sub-mode requiring interactive keyboard input to verify flow | With sessions selected, press `enter`. Confirm a summary line appears showing counts (e.g., "Archive N sessions, delete M sessions. Proceed? (y/n)"). |
| AC5.4 | End-to-end archival/deletion involves store mutations triggered by interactive TUI flow; no programmatic test harness available | From confirmation prompt, press `y`. Verify sessions with messages are archived (check for `archive:session:*` documents in the store). Verify empty sessions are deleted. Verify Sessions screen reflects the changes after returning. |
| AC5.5 | Navigation flow between screens requires the full Ink render tree | From Prune Screen (select mode), press `escape`. Confirm navigation returns to Sessions screen with no sessions modified. |
| AC5.6 | Keybinding registration in App.tsx and screen routing requires the full TUI stack running | From Sessions screen, press `r`. Confirm Prune Screen renders. Also verify `r` keybinding label appears in SessionsScreen's StatusBar. |

**Notes:** If the app cannot be started (missing config, API keys, etc.), fall back to `bunx tsc --noEmit` to verify the code compiles, and document manual test results when the environment is available. All AC5 criteria share the same root justification: the project does not include ink-testing-library, and adding it is out of scope for this feature.

---

## Summary

| Phase | Criteria | Automated | Manual | Test Files |
|-------|----------|-----------|--------|------------|
| 1 | AC1.1, AC1.2, AC1.3 | 3 | 0 | `src/store/store.test.ts` |
| 2 | AC2.1 -- AC2.8 | 8 | 0 | `src/sessions/archive.test.ts` |
| 3 | AC3.1 -- AC3.7 | 7 | 0 | `src/sessions/archiver.test.ts` |
| 4 | AC4.1 -- AC4.4 | 4 | 0 | `src/tools/sessions.test.ts` |
| 5 | AC5.1 -- AC5.6 | 0 | 6 | (manual) |
| **Total** | **28** | **22** | **6** | **4 test files** |
