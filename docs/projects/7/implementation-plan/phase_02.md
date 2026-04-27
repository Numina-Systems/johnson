# GH07: Built-In Web Tools — Phase 2

**Goal:** Wire the web tools into the agent by calling `registerWebTools()` from `createAgentTools()`, and verify that stubs and documentation are generated correctly.

**Architecture:** `createAgentTools()` in `src/agent/tools.ts` is the single factory that populates the `ToolRegistry` for each agent call. Adding one function call to `registerWebTools(registry, deps)` makes all three web tools available in the sandbox as `tools.web_search(...)`, `tools.fetch_page(...)`, `tools.http_get(...)`.

**Tech Stack:** TypeScript (strict mode), Bun test runner

**Scope:** 2 phases from design (phase 2 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH07.AC5: All three registered as sandbox tools
- **GH07.AC5.1 Success:** All three registered into the ToolRegistry (currently sandbox-only, mode support pending #3)

### GH07.AC6: TypeScript stubs generated
- **GH07.AC6.1 Success:** TypeScript stubs generated so sandbox code can call `tools.web_search(...)`, `tools.fetch_page(...)`, `tools.http_get(...)` 

### GH07.AC7: Tool documentation in system prompt
- **GH07.AC7.1 Success:** Tool documentation appears in system prompt output from `generateToolDocumentation()`

### GH07.AC9: Missing key integration test
- **GH07.AC9.1 Test:** Missing Exa key, verify error message for search/fetch, success for http_get (integration-level, through `createAgentTools`)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Wire `registerWebTools` into `createAgentTools`

**Verifies:** GH07.AC5.1

**Files:**
- Modify: `src/agent/tools.ts`

**Context files to read before implementing:**
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/agent/tools.ts` — the existing `createAgentTools()` function. All 8 existing tools are registered inline. We add one import + one function call.
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/tools/web.ts` — the module from Phase 1 exporting `registerWebTools(registry, deps)`

**Implementation:**

Two changes to `src/agent/tools.ts`:

1. **Add import** at the top of the file (after the existing imports around line 7):
   ```typescript
   import { registerWebTools } from '../tools/web.ts';
   ```

2. **Call `registerWebTools`** inside `createAgentTools()`, after the last `registry.register()` call for `cancel_task` (around line 325, just before `return registry;`):
   ```typescript
   // Web tools (search, fetch, http)
   registerWebTools(registry, deps);
   ```

That's it. Two lines. The existing registry plumbing handles stub generation, documentation, and dispatch automatically.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(web-tools): register web tools in agent tool factory`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integration tests for registration, stubs, and documentation

**Verifies:** GH07.AC5.1, GH07.AC6.1, GH07.AC7.1, GH07.AC9.1

**Files:**
- Create: `src/agent/tools.test.ts`

**Context files to read before implementing:**
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/agent/tools.ts` — `createAgentTools(deps, context)` signature and return type
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/agent/types.ts` — `AgentDependencies` and `ChatContext` types for constructing test deps
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/runtime/tool-registry.ts` — `ToolRegistry` type with `list()`, `generateTypeScriptStubs()`, `generateToolDocumentation()` methods
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/store/store.ts` — `Store` type (needed for deps stub). Check what methods `createAgentTools` actually calls on store (it's `docUpsert`, `docGet`, `docList`, `docSearch`, `getGrant`, `saveGrant`, `saveEmbedding`).
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/secrets/manager.ts` — `SecretManager` type

**Test framework:** Bun test runner (`bun:test`).

**Mocking strategy:**
- Create a minimal `AgentDependencies` stub. The `createAgentTools` function only reads `deps` properties at registration time for secret resolution (inside handlers), so most deps can be stubs that satisfy the type checker. Key fields:
  - `store`: stub with no-op methods for the Store interface
  - `secrets`: configurable `SecretManager` stub (same as Phase 1 tests)
  - `model`, `runtime`, `config`, `personaPath`: minimal stubs/values
- `ChatContext`: `{}` (empty object)

**Testing — test cases that must be covered:**

1. **GH07.AC5.1 — Web tools are registered:** Call `createAgentTools(deps, context)`. Call `registry.list()`. Assert the returned array includes entries with names `'web_search'`, `'fetch_page'`, and `'http_get'`.

2. **GH07.AC6.1 — TypeScript stubs include web tools:** Call `registry.generateTypeScriptStubs()`. Assert the returned string contains `export async function web_search(`, `export async function fetch_page(`, and `export async function http_get(`.

3. **GH07.AC7.1 — Documentation includes web tools:** Call `registry.generateToolDocumentation()`. Assert the returned string contains `### \`tools.web_search\``, `### \`tools.fetch_page\``, and `### \`tools.http_get\``.

4. **GH07.AC9.1 — Integration: missing Exa key error for search, success for http_get:** Create deps where `secrets.get('EXA_API_KEY')` returns `undefined` and `process.env['EXA_API_KEY']` is unset. Call `registry.execute('web_search', { query: 'test' })`. Assert result is the Exa-not-configured error string. Call `registry.execute('http_get', { url: 'https://example.com' })` (with fetch mocked to return 200 OK). Assert a successful structured result.

**Verification:**
Run: `bun test`
Expected: All tests pass (both Phase 1 and Phase 2 test files)

**Commit:** `test(web-tools): add integration tests for tool registration, stubs, and docs`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Final verification

**Files:** None (verification only)

**Step 1: Type check**
Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**
Run: `bun test`
Expected: All tests pass

**Step 3: Build**
Run: `bun run build`
Expected: Build succeeds. Web tools are now part of the agent and will be available when the agent starts.

**Step 4: Verify tool count**
Quick sanity check — the registry should now have 11 tools (8 existing + 3 new):
- Existing: `doc_upsert`, `doc_get`, `doc_list`, `doc_search`, `run_skill`, `schedule_task`, `list_tasks`, `cancel_task`
- New: `web_search`, `fetch_page`, `http_get`

This is verified by the integration test in Task 2 (AC5.1).
<!-- END_TASK_3 -->
