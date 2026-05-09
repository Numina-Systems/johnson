# Prompt Templates Implementation Plan — Phase 2

**Goal:** Consolidate all three prompt assembly callsites to use the new `buildSystemPrompt()` from `prompt.ts`, remove `personaPath` and `systemPromptProvider` from dependency types.

**Architecture:** Each callsite (`agent.ts`, `index.ts`, `App.tsx`) replaces its inline prompt assembly logic with a direct call to `buildSystemPrompt(params)`. The `systemPromptProvider` indirection layer and `personaPath` field are removed entirely. Custom tools appending moves into params.

**Tech Stack:** TypeScript, bun:test

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-05-08

---

## Acceptance Criteria Coverage

This phase implements and tests:

### prompt-templates.AC3: Three callsites consolidated
- **prompt-templates.AC3.1 Success:** `src/agent/agent.ts` calls `buildSystemPrompt()` directly without `buildInlinePrompt()` or `systemPromptProvider`
- **prompt-templates.AC3.2 Success:** `src/index.ts` has no `systemPromptProvider` callback or `PERSONA_PATH` constant
- **prompt-templates.AC3.3 Success:** `src/tui/App.tsx` calls `buildSystemPrompt()` directly without separate custom tools appending
- **prompt-templates.AC3.4 Failure:** No references to `personaPath` remain in `AgentDependencies` or `TuiDependencies`

### prompt-templates.AC4: Custom tools listing integrated
- **prompt-templates.AC4.1 Success:** `customToolSummaries` param renders approved tools in the prompt
- **prompt-templates.AC4.2 Success:** Empty `customToolSummaries` omits the custom tools list section
- **prompt-templates.AC4.3 Success:** `secretNames` param renders available secret names in the custom tools template

### prompt-templates.AC5: personaPath removed from deps
- **prompt-templates.AC5.1 Success:** `AgentDependencies` in `src/agent/types.ts` has no `personaPath` field
- **prompt-templates.AC5.2 Success:** `TuiDependencies` in `src/tui/types.ts` has no `personaPath` field
- **prompt-templates.AC5.3 Success:** No `Bun.file()` calls for persona content anywhere in codebase

### prompt-templates.AC6: Tests updated (partial)
- **prompt-templates.AC6.5 Success:** Old `buildSystemPrompt` tests in `context.test.ts` removed (no dead tests)

---

**Note:** After this phase completes and before Phase 3 completes, the file ingestion domain knowledge (intent inference heuristics, pandoc conversion guidance) will be absent from the system prompt. This is a known transient gap — Phase 3 seeds this content into the self document. Since phases execute sequentially in a single session, this gap has no user impact.

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Remove `personaPath` and `systemPromptProvider` from dependency types

**Verifies:** prompt-templates.AC5.1, prompt-templates.AC5.2, prompt-templates.AC3.4

**Files:**
- Modify: `src/agent/types.ts:48-66` (AgentDependencies)
- Modify: `src/tui/types.ts:13-25` (TuiDependencies)

**Implementation:**

In `src/agent/types.ts`, remove these two fields from the `AgentDependencies` type:
- Line 52: `readonly personaPath: string;`
- Lines 60-63: `readonly systemPromptProvider?: (toolDocs: string, recalledContext?: ReadonlyArray<RecalledContextEntry>) => Promise<string>;`

In `src/tui/types.ts`, remove these two fields from the `TuiDependencies` type:
- Line 20: `readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;`
- Line 23: `readonly personaPath?: string;`

After these removals, the build will fail at the callsites that reference these fields — that's expected and will be fixed in the subsequent tasks.

**Verification:**

Run: `bun run build`
Expected: Build fails with type errors at callsites referencing removed fields (agent.ts, index.ts, App.tsx). This is expected — Tasks 2 and 3 fix these.

**Commit:** Do not commit yet — this task is part of the subcomponent. Commit after Task 3.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Consolidate `src/agent/agent.ts` to use new `buildSystemPrompt()`

**Verifies:** prompt-templates.AC3.1, prompt-templates.AC4.1, prompt-templates.AC4.2, prompt-templates.AC4.3

**Files:**
- Modify: `src/agent/agent.ts:13` (imports)
- Modify: `src/agent/agent.ts:209-250` (prompt building section)

**Implementation:**

**Update imports (line 13):**
- Change: `import { buildSystemPrompt, estimateTokens, loadCoreMemoryFromStore, repairConversation, trimOldToolResults } from './context.ts';`
- To: `import { estimateTokens, loadCoreMemoryFromStore, repairConversation, trimOldToolResults } from './context.ts';`
- Add new import: `import { buildSystemPrompt } from './prompt.ts';`
- Also add `import type { SystemPromptParams } from './prompt.ts';` if needed for type annotations (or import alongside `buildSystemPrompt`).

**Replace the prompt building section (lines 209-250):**

Remove:
1. The `buildInlinePrompt` closure (lines 212-222) — this reads persona from disk and calls the old `buildSystemPrompt()`
2. The `systemPromptProvider` conditional block (lines 224-240) — this delegates to the provider callback with fallback
3. The custom tools appending block (lines 242-250) — this appends custom tools listing after prompt is built

Replace with direct param gathering and `buildSystemPrompt()` call:

```typescript
// Build system prompt directly — no provider indirection
const selfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
const allDocs = deps.store.docList(500);
const skillNames = allDocs.documents
  .filter(d => d.rkey.startsWith('skill:'))
  .map(d => d.rkey);

const customToolSummaries = deps.customTools
  ? deps.customTools.getApprovedToolSummaries()
  : undefined;

const secretNames = deps.secrets
  ? deps.secrets.listKeys()
  : undefined;

systemPrompt = buildSystemPrompt({
  selfDoc,
  skillNames,
  toolDocs,
  timezone: deps.config.timezone,
  recalledContext,
  customToolSummaries,
  secretNames,
});
```

Note: Use `deps.store.docGet('self')?.content` directly — do NOT use `loadCoreMemoryFromStore()` here, because that function wraps the content in a `## Your Memory` header which would duplicate the header in `SELF_DOC_TEMPLATE`. The `selfDoc` param expects raw content, not pre-formatted content.

`recalledContext` is already available at this point (populated from the recall step above, lines 189-206). `toolDocs` is already available from tool registration (line ~180).

Remove the `cachedSystemPrompt` variable and its usage (it was only needed for the provider fallback pattern). Search for `cachedSystemPrompt` in the file and remove the declaration and all references.

Also remove `loadCoreMemoryFromStore` from the import on line 13 (from `./context.ts`) if it's no longer used in this file.

**Verification:**

Run: `bun run build`
Expected: Build fails only at `index.ts` and `App.tsx` (fixed in Task 3). No errors in `agent.ts`.

**Commit:** Do not commit yet — this task is part of the subcomponent. Commit after Task 3.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Consolidate `src/index.ts` and `src/tui/App.tsx`, update barrel exports

**Verifies:** prompt-templates.AC3.2, prompt-templates.AC3.3, prompt-templates.AC5.3

**Files:**
- Modify: `src/index.ts:34` (PERSONA_PATH constant)
- Modify: `src/index.ts:113-124` (systemPromptProvider callback)
- Modify: `src/index.ts:126-151` (agentDeps object)
- Modify: `src/tui/App.tsx:31-58` (getSystemPrompt function)
- Modify: `src/agent/index.ts:4` (barrel export)

**Implementation:**

**`src/index.ts` changes:**

1. Remove the `PERSONA_PATH` constant (line 34): `const PERSONA_PATH = resolve(import.meta.dir, '..', 'persona.md');`
2. Remove the `systemPromptProvider` callback function (lines 113-124). This entire function reads persona from disk, loads core memory, extracts skill names, and calls `buildSystemPrompt()` — all of which is now done directly in `agent.ts`.
3. Remove `personaPath: PERSONA_PATH,` from the `agentDeps` object (line 141).
4. Remove `systemPromptProvider` from the `agentDeps` object (wherever it's assigned — should be around lines 149-150 based on the callback being passed).
5. Remove the `resolve` import from `'node:path'` if `PERSONA_PATH` was its only consumer. Check if `resolve` is used elsewhere in the file first.
6. Remove imports of `buildSystemPrompt`, `loadCoreMemoryFromStore`, and `RecalledContextEntry` if they were only used by the `systemPromptProvider` callback. Check each import's usage before removing.

**`src/tui/App.tsx` changes:**

The current `getSystemPrompt()` function (lines 31-58):
- Checks for `systemPromptProvider` and uses it if available
- Falls back to inline persona file read + `buildSystemPrompt()` call
- Appends custom tools listing separately

Replace the entire `getSystemPrompt` implementation with a direct call:

```typescript
import { buildSystemPrompt } from '../agent/prompt.ts';
```

The new `getSystemPrompt` should:
1. Get raw self doc content: `deps.store.docGet('self')?.content?.trim() ?? ''` (do NOT use `loadCoreMemoryFromStore()` — see note in Task 2 about header duplication)
2. Extract skill names from `deps.store.docList(500)`
3. Get custom tool summaries from `deps.customTools` if available
4. Get secret names from `deps.secrets` if available
5. Call `buildSystemPrompt({ selfDoc, skillNames, toolDocs, timezone: deps.timezone, customToolSummaries, secretNames })`
6. Return the result — no separate custom tools appending

Remove any `Bun.file()` calls for persona content. Remove the `systemPromptProvider` check and fallback logic.

Note: The TUI's `getSystemPrompt` receives `toolDocs` as a parameter. Keep that parameter — it comes from the tool registry. The TUI does not run recall, so `recalledContext` is not passed (it's optional in `SystemPromptParams`).

**`src/agent/index.ts` barrel export changes (line 4):**

Current: `export { buildSystemPrompt, estimateTokens, shouldTruncate } from './context.ts';`

Change to:
```typescript
export { estimateTokens, shouldTruncate } from './context.ts';
export { buildSystemPrompt } from './prompt.ts';
export type { SystemPromptParams } from './prompt.ts';
```

This re-exports the new `buildSystemPrompt` from `prompt.ts` instead of `context.ts`. Any external consumers importing from `'./agent'` or `'../agent'` will get the new version.

**Verification:**

Run: `bun run build`
Expected: Build succeeds with no type errors

Run: `bun test`
Expected: All existing tests pass (context.test.ts tests for `buildSystemPrompt` may fail — those are addressed in Task 4)

**Commit:** `refactor(prompt): consolidate three callsites to use buildSystemPrompt from prompt.ts`

This commit includes all changes from Tasks 1-3 as they form one atomic refactor.

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update `context.test.ts` to remove old `buildSystemPrompt` tests

**Verifies:** prompt-templates.AC6.5

**Files:**
- Modify: `src/agent/context.test.ts:1-183`

**Implementation:**

The file `src/agent/context.test.ts` contains ONLY tests for the old `buildSystemPrompt()` function signature — 9 test cases across 3 describe blocks, no tests for any other function. These tests are now covered by the new `prompt.test.ts` from Phase 1.

Delete the entire file `src/agent/context.test.ts`.

**Verification:**

Run: `bun test`
Expected: All tests pass

**Commit:** `test(prompt): delete context.test.ts (buildSystemPrompt tests moved to prompt.test.ts)`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update `src/agent/agent.test.ts` and `src/agent/tools.test.ts` for removed deps fields

**Verifies:** prompt-templates.AC3.4

**Files:**
- Modify: `src/agent/agent.test.ts` (update mock deps — remove `personaPath` and `systemPromptProvider`)
- Modify: `src/agent/tools.test.ts` (update mock deps if it references `personaPath`)

**Implementation:**

Test files that create mock `AgentDependencies` objects will fail after removing `personaPath` and `systemPromptProvider` from the type. Find all instances where these fields are set in test fixtures and remove them.

In `src/agent/agent.test.ts`:
- Find the `makeDeps()` or equivalent factory function that creates mock `AgentDependencies`
- Remove `personaPath` field from the mock object
- Remove `systemPromptProvider` field from the mock object (if present)

In `src/agent/tools.test.ts`:
- Same — check if it creates `AgentDependencies` mocks and remove the fields

In any other test files that reference `AgentDependencies`:
- Search for `personaPath` across all `.test.ts` files and remove references

**Verification:**

Run: `bun test`
Expected: All tests pass

**Commit:** `test: update agent test fixtures for removed personaPath and systemPromptProvider`

<!-- END_TASK_5 -->
