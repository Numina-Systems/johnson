# Reflexive Recall Implementation Plan — Phase 4: System Prompt Injection

**Goal:** Inject recalled context into the system prompt at the correct position, between the self doc and Available Skills sections.

**Architecture:** Extend the existing `buildSystemPrompt()` function in `src/agent/context.ts` with an optional `recalledContext` parameter. When present, a `## Recalled Context` section is inserted after the self doc section and before Available Skills. Each fragment is rendered with its rkey as a header and content below — no score metadata exposed to the model.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-05-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC7: Prompt Injection
- **reflexive-recall.AC7.1 Success:** Recalled context section appears after self doc, before Available Skills
- **reflexive-recall.AC7.2 Success:** Each fragment rendered with rkey header and content, no score metadata
- **reflexive-recall.AC7.3 Success:** Absent recalledContext produces no section in prompt

### reflexive-recall.AC4: Token Budget (partial)
- **reflexive-recall.AC4.3 Edge:** Zero matching documents produces no system prompt section

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Extend buildSystemPrompt with recalledContext parameter

**Verifies:** reflexive-recall.AC7.1, reflexive-recall.AC7.2, reflexive-recall.AC7.3, reflexive-recall.AC4.3

**Files:**
- Modify: `src/agent/context.ts:16-59` (buildSystemPrompt function)

**Implementation:**

The current `buildSystemPrompt` signature at `src/agent/context.ts:16-22` is:

```typescript
export function buildSystemPrompt(
  persona: string,
  selfDoc: string,
  skillNames: ReadonlyArray<string>,
  toolDocs: string = '',
  timezone: string = 'UTC',
): string
```

Add `recalledContext` as an optional parameter. Since the function uses individual params (not an options object), add it as the last parameter (after `timezone`). This preserves backward compatibility — all existing callers continue to work without changes since the new parameter is optional:

```typescript
export function buildSystemPrompt(
  persona: string,
  selfDoc: string,
  skillNames: ReadonlyArray<string>,
  toolDocs: string = '',
  timezone: string = 'UTC',
  recalledContext?: ReadonlyArray<{ readonly rkey: string; readonly content: string }>,
): string
```

Import `RecallFragment` type from `../recall/retrieve.ts` for the parameter type — or use an inline structural type to avoid a circular dependency. Since `buildSystemPrompt` only needs `rkey` and `content` (not `score` or `source`), use a minimal inline type as shown above. This avoids coupling context.ts to the recall module.

In the function body, after the selfDoc section push (line 40-41) and before the Available Skills section (line 44), add:

```typescript
if (recalledContext && recalledContext.length > 0) {
  const fragmentsText = recalledContext
    .map(f => `### ${f.rkey}\n${f.content}`)
    .join('\n\n');
  sections.push(`\n\n## Recalled Context\n${fragmentsText}`);
}
```

This ensures:
- AC7.1: Section appears after self doc, before Available Skills (insertion point between existing sections)
- AC7.2: Each fragment rendered with rkey header and content, no score metadata
- AC7.3: When `recalledContext` is undefined or empty array, no section is pushed
- AC4.3: Zero fragments = no section in prompt

**Callers that need updating:**

There are two places that call `buildSystemPrompt()`:

1. `src/index.ts:116` — the shared `systemPromptProvider`. This will be updated in Phase 5 to pass recalled context.
2. `src/agent/agent.ts:164` — the fallback inline prompt builder. This will also be updated in Phase 5.

For now, both callers continue working without changes because `recalledContext` is optional and defaults to undefined. No breaking change.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors. Existing tests pass (no context.test.ts exists, but agent.test.ts and others that exercise the prompt pipeline should still pass).

```bash
bun test
```

Expected: All existing tests pass unchanged.

**Commit:** `feat(recall): extend buildSystemPrompt with optional recalledContext injection`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: System prompt injection tests

**Verifies:** reflexive-recall.AC7.1, reflexive-recall.AC7.2, reflexive-recall.AC7.3, reflexive-recall.AC4.3

**Files:**
- Create: `src/agent/context.test.ts`

**Testing:**

Use `bun:test` with `describe`/`test`/`expect`. These are pure function tests — no mocks needed since `buildSystemPrompt` is a Functional Core function that takes plain data and returns a string.

Tests must verify each AC listed:

**reflexive-recall.AC7.1 — Section positioning:**

Call `buildSystemPrompt` with a non-empty `recalledContext` array. Verify that in the returned string:
- `## Recalled Context` appears AFTER `## Your Memory` (the self doc section header)
- `## Recalled Context` appears BEFORE `## Available Skills`
- Use `indexOf()` comparisons to verify ordering: `prompt.indexOf('Recalled Context') > prompt.indexOf('Your Memory')` and `prompt.indexOf('Recalled Context') < prompt.indexOf('Available Skills')`

**reflexive-recall.AC7.2 — Fragment rendering:**

Call with `recalledContext: [{ rkey: 'knowledge:caldav', content: 'CalDAV protocol notes' }, { rkey: 'skill:fetch-page', content: 'Fetches web pages' }]`. Verify:
- Output contains `### knowledge:caldav\nCalDAV protocol notes`
- Output contains `### skill:fetch-page\nFetches web pages`
- Output does NOT contain `score` or any numeric metadata

**reflexive-recall.AC7.3 — Absent recalledContext:**

Call `buildSystemPrompt` without the `recalledContext` parameter (undefined). Verify output does NOT contain `## Recalled Context`.

Call with `recalledContext: []` (empty array). Verify output does NOT contain `## Recalled Context`.

**reflexive-recall.AC4.3 — Zero documents = no section:**

Same as AC7.3 empty array test above — confirms zero matching documents produces no section.

**Additional test: existing sections unaffected:**

Call with recalledContext and verify that Persona, Current Time, Available Skills, and Tool Reference sections are still present and correctly formatted. This ensures the injection didn't break existing section assembly.

**Verification:**

```bash
bun test src/agent/context.test.ts
```

Expected: All tests pass.

**Commit:** `test(recall): add system prompt injection tests`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
