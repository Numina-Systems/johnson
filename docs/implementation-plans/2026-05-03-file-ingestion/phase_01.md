# File Ingestion Implementation Plan — Phase 1

**Goal:** Register `ingest_file` tool, implement path resolution with security, read small files, and dispatch by intent (memory, knowledge, context).

**Architecture:** New `src/tools/ingest.ts` module following `register*Tools()` pattern. Tool handler runs in parent process (like `doc_upsert`), registered as sandbox mode so model can call it via `execute_code`. Path resolution canonicalises against `workingDir` and rejects traversal. Intent dispatch routes to `store.docUpsert()` for memory/knowledge, or returns content for context.

**Tech Stack:** Bun runtime, `node:path` for path resolution, `node:fs/promises` for file reading, existing `Store` interface for persistence.

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-05-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### file-ingestion.AC1: Path resolution and security
- **file-ingestion.AC1.1 Success:** @/notes.md resolves to workingDir/notes.md and reads content
- **file-ingestion.AC1.2 Success:** Nested paths (@/sub/dir/file.md) resolve correctly
- **file-ingestion.AC1.3 Failure:** Path traversal (../../etc/passwd) is rejected with error
- **file-ingestion.AC1.4 Failure:** Absolute paths outside workingDir are rejected

### file-ingestion.AC2: Intent routing — memory
- **file-ingestion.AC2.1 Success:** Small file with memory intent appends facts to self document
- **file-ingestion.AC2.3 Success:** Memory additions have `<!-- from: filename -->` separator for traceability

### file-ingestion.AC3: Intent routing — knowledge
- **file-ingestion.AC3.1 Success:** Small file stored as `knowledge:<name>` document

### file-ingestion.AC4: Intent routing — context
- **file-ingestion.AC4.1 Success:** Small file content returned as tool result, nothing persisted

### file-ingestion.AC6: Cross-cutting
- **file-ingestion.AC6.1:** Tool works identically when called from TUI or Discord sessions (satisfied by architecture — tool is registered at agent layer via `createAgentTools()`, no interface-specific code)
- **file-ingestion.AC6.2:** Embedding hooks fire for persisted documents (knowledge and memory intents)
- **file-ingestion.AC6.3:** Tool result includes tokenEstimate and chunk count for agent awareness

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/tools/ingest.ts` with path resolution and tool registration

**Verifies:** file-ingestion.AC1.1, file-ingestion.AC1.2, file-ingestion.AC1.3, file-ingestion.AC1.4

**Files:**
- Create: `src/tools/ingest.ts`
- Modify: `src/agent/tools.ts:7-12` (add import) and `src/agent/tools.ts:389` (add registration call)

**Implementation:**

Create `src/tools/ingest.ts` with `registerIngestTools(registry, deps, workingDir)`. The function takes `workingDir` as a direct parameter (since `AgentDependencies` only carries `AgentConfig`, not `RuntimeConfig`).

The tool handler:
1. Receives `path` and `intent` parameters
2. Strips leading `@/` or `/` from path (normalise user input)
3. Resolves against `workingDir` using `node:path` `resolve()`
4. Canonicalises with `realpath` or manual canonicalisation
5. Validates resolved path starts with `workingDir` (traversal check)
6. Reads file content via `Bun.file().text()`
7. Estimates tokens (chars / 4)
8. If small (≤ 4096 token estimate): dispatches to intent handler
9. If large: returns early with a message (Phase 2 adds chunking)

Path resolution security:
- Resolve `join(workingDir, userPath)` and normalise with `resolve()`
- Check `!resolved.startsWith(workingDir)` → reject
- This catches `../../`, absolute paths, symlink escapes

Wire into `createAgentTools()`:
- Import `registerIngestTools` from `'../tools/ingest.ts'`
- Call `registerIngestTools(registry, deps, config.runtime.workingDir)` — but since `createAgentTools` doesn't receive `AppConfig`, pass `workingDir` when calling from `src/index.ts`

**Approach for `workingDir` access:**
The function `createAgentTools()` in `src/agent/tools.ts` receives `deps: AgentDependencies`. Since `AgentDependencies` doesn't include `workingDir`, modify `createAgentTools` to accept an optional third parameter or extend the existing `ChatContext` type with `workingDir`. The simplest approach: add `workingDir?: string` to `AgentDependencies`. This is a minor extension since `AgentDependencies` is constructed in `src/index.ts:118-139` where `config.runtime.workingDir` is available.

Add to `AgentDependencies` in `src/agent/types.ts`:
```typescript
export type AgentDependencies = {
  // ... existing fields ...
  readonly workingDir?: string;
};
```

Then in `src/index.ts:118-139`, add `workingDir: config.runtime.workingDir` to `agentDeps`.

In `src/tools/ingest.ts`, access via `deps.workingDir`.

**Tool registration shape:**
```typescript
registry.register(
  'ingest_file',
  {
    name: 'ingest_file',
    description: `Read a file from the workspace and process it by intent.

When the user references a file with @/path/to/file, call this tool to ingest it.

Intents:
- memory: Extract facts and append to your self document
- knowledge: Store as a searchable knowledge document
- context: Return content for this conversation only (nothing persisted)`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path (e.g. "notes.md" or "sub/dir/file.md")' },
        intent: { type: 'string', enum: ['memory', 'knowledge', 'context'], description: 'How to process the file content' },
      },
      required: ['path', 'intent'],
    },
  },
  handler,
);
```

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All path resolution and security tests pass

**Commit:** `feat(ingest): add ingest_file tool with path resolution and security`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Path resolution and security tests

**Verifies:** file-ingestion.AC1.1, file-ingestion.AC1.2, file-ingestion.AC1.3, file-ingestion.AC1.4

**Files:**
- Create: `src/tools/ingest.test.ts`

**Testing:**
Tests must verify each AC listed above. Follow existing pattern from `src/tools/web.test.ts` — create a `ToolRegistry`, call `registerIngestTools()`, then use `registry.execute('ingest_file', params)`.

Use a temp directory (via `mkdtempSync`) as `workingDir` with test files written to it in `beforeAll`.

Test cases:
- **file-ingestion.AC1.1:** Call with `path: 'notes.md'`, verify content is returned (use `context` intent for simplicity)
- **file-ingestion.AC1.2:** Call with `path: 'sub/dir/file.md'`, verify nested path resolves and reads
- **file-ingestion.AC1.3:** Call with `path: '../../etc/passwd'`, verify error thrown/returned mentioning traversal
- **file-ingestion.AC1.4:** Call with `path: '/etc/passwd'` (absolute outside workingDir), verify rejection

**Dependencies for test setup:**
- Mock `AgentDependencies` using existing `createStore(':memory:')` pattern
- Create temp directory with test fixtures
- No fetch mocking needed

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All 4+ tests pass

**Commit:** `test(ingest): add path resolution and security tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Intent dispatch — memory, knowledge, context

**Verifies:** file-ingestion.AC2.1, file-ingestion.AC2.3, file-ingestion.AC3.1, file-ingestion.AC4.1, file-ingestion.AC6.2, file-ingestion.AC6.3

**Files:**
- Modify: `src/tools/ingest.ts` (add intent dispatch logic inside handler)

**Implementation:**

After reading file content and estimating tokens, dispatch based on `intent`:

**`context` intent:**
- Return the file content directly as the tool result
- No persistence, no store calls
- Include `tokenEstimate` in result

**`memory` intent:**
- Read current `self` document via `deps.store.docGet('self')`
- Append content with separator: `\n\n<!-- from: ${filename} -->\n${content}`
- Write back via `deps.store.docUpsert('self', updated)`
- Fire embedding hook if `deps.embedding` is available (same pattern as `doc_upsert` handler in `src/agent/tools.ts:91-95`)
- Fire recall encoding hook if `deps.recallClient` is available (same pattern as `src/agent/tools.ts:98-102`)
- Return confirmation with `tokenEstimate`

**`knowledge` intent:**
- Derive rkey from filename: `knowledge:${basename}` (strip extension, replace spaces with hyphens, lowercase)
- Store via `deps.store.docUpsert(rkey, content)`
- Fire embedding hook (same pattern)
- Fire recall encoding hook (same pattern)
- Return confirmation with `rkey` and `tokenEstimate`

**Result shape (returned as JSON string):**
```typescript
JSON.stringify({
  content: intent === 'context' ? fileContent : `Stored as ${rkey}`,
  rkey: intent === 'context' ? undefined : rkey,
  tokenEstimate,
  chunks: 0,
})
```

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All intent dispatch tests pass

**Commit:** `feat(ingest): implement intent dispatch for memory, knowledge, and context`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Intent dispatch tests

**Verifies:** file-ingestion.AC2.1, file-ingestion.AC2.3, file-ingestion.AC3.1, file-ingestion.AC4.1, file-ingestion.AC6.2, file-ingestion.AC6.3

**Files:**
- Modify: `src/tools/ingest.test.ts` (add intent test cases)

**Testing:**

Use in-memory store (`createStore(':memory:')`) to verify persistence. Mock embedding provider to verify hooks fire.

Test cases:
- **file-ingestion.AC2.1:** Ingest small file with `intent: 'memory'`, verify `store.docGet('self')` now contains the file content
- **file-ingestion.AC2.3:** Verify the stored self content includes `<!-- from: notes.md -->` separator
- **file-ingestion.AC3.1:** Ingest small file with `intent: 'knowledge'`, verify `store.docGet('knowledge:notes')` returns the content
- **file-ingestion.AC4.1:** Ingest with `intent: 'context'`, verify result contains file content, verify `store.docGet('knowledge:notes')` is still null (nothing persisted)
- **file-ingestion.AC6.2:** Mock embedding provider, verify `embed()` is called for memory and knowledge intents, NOT called for context intent
- **file-ingestion.AC6.3:** Parse JSON result, verify `tokenEstimate` field is present and is a number > 0

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All tests pass

**Commit:** `test(ingest): add intent dispatch tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Wire `registerIngestTools` into `createAgentTools` and extend `AgentDependencies`

**Note:** Tasks 1-4 are self-contained — they test `registerIngestTools()` directly on a fresh `ToolRegistry` without needing the full agent wiring. This task integrates the module into the real system so `ingest_file` is available at runtime.

**Verifies:** None (infrastructure wiring)

**Files:**
- Modify: `src/agent/types.ts:39-53` (add `workingDir` field)
- Modify: `src/agent/tools.ts:7-12` (add import)
- Modify: `src/agent/tools.ts:389` (add registration call)
- Modify: `src/index.ts:118-139` (add `workingDir` to agentDeps)

**Implementation:**

1. In `src/agent/types.ts`, add to `AgentDependencies`:
   ```typescript
   readonly workingDir?: string;
   ```

2. In `src/agent/tools.ts`, add import:
   ```typescript
   import { registerIngestTools } from '../tools/ingest.ts';
   ```

3. In `src/agent/tools.ts`, after the custom tools registration (line ~389), add:
   ```typescript
   if (deps.workingDir) {
     registerIngestTools(registry, deps);
   }
   ```

4. In `src/index.ts`, add `workingDir: config.runtime.workingDir` to the `agentDeps` object.

**Verification:**
Run: `bun test`
Expected: All 210+ tests pass (no regressions)

Run: `bun run build`
Expected: Build succeeds

**Commit:** `feat(ingest): wire registerIngestTools into agent tool system`

<!-- END_TASK_5 -->
