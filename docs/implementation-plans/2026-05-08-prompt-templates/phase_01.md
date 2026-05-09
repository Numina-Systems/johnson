# Prompt Templates Implementation Plan — Phase 1

**Goal:** Create `src/agent/prompt.ts` with template constants extracted from `persona.md` and a typed `buildSystemPrompt()` function, plus comprehensive tests.

**Architecture:** A new Functional Core module containing module-private `UPPER_SNAKE_CASE` template constants and a single exported `buildSystemPrompt()` function that assembles them. The function is pure — no I/O, no store access, no file reads.

**Tech Stack:** TypeScript, bun:test

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-05-08

---

## Acceptance Criteria Coverage

This phase implements and tests:

### prompt-templates.AC1: persona.md content decomposed into template constants
- **prompt-templates.AC1.1 Success:** `src/agent/prompt.ts` exists with module-private template constants for each system prompt concern
- **prompt-templates.AC1.2 Success:** Each constant contains the exact text from its corresponding persona.md section (no content changes)
- **prompt-templates.AC1.4 Failure:** Build fails if any template constant references a removed symbol or import

### prompt-templates.AC2: Single typed build function
- **prompt-templates.AC2.1 Success:** `buildSystemPrompt(params: SystemPromptParams)` exported from `src/agent/prompt.ts`
- **prompt-templates.AC2.2 Success:** Function is pure — no I/O, no store access, no file reads
- **prompt-templates.AC2.3 Success:** Optional params (recalledContext, customToolSummaries, toolDocs) are omitted from output when empty/undefined
- **prompt-templates.AC2.4 Success:** Assembly order matches the specified sequence (memory check through custom tools list)
- **prompt-templates.AC2.5 Success:** Dynamic placeholders ({timezone}, {native_tools_list}, {secret_names}) interpolated correctly
- **prompt-templates.AC2.6 Failure:** Empty selfDoc still produces valid prompt (section present but empty content)

### prompt-templates.AC6: Tests updated
- **prompt-templates.AC6.1 Success:** `src/agent/prompt.test.ts` tests each template block inclusion/exclusion
- **prompt-templates.AC6.2 Success:** Tests verify conditional blocks (recalled context, custom tools, skills) appear/disappear based on params
- **prompt-templates.AC6.3 Success:** Tests verify interpolation of dynamic placeholders
- **prompt-templates.AC6.4 Success:** Tests verify assembly order

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/agent/prompt.ts` with template constants and `buildSystemPrompt()`

**Verifies:** prompt-templates.AC1.1, prompt-templates.AC1.2, prompt-templates.AC2.1, prompt-templates.AC2.2, prompt-templates.AC2.3, prompt-templates.AC2.4, prompt-templates.AC2.5, prompt-templates.AC2.6

**Files:**
- Create: `src/agent/prompt.ts`

**Implementation:**

Create `src/agent/prompt.ts` annotated with `// pattern: Functional Core`. Define the following module-private (`const`, not exported) template constants using `UPPER_SNAKE_CASE`:

**Static sections** — copy text verbatim from `persona.md`:

1. `MEMORY_CHECK_SECTION` — the "Before You Act — Check Your Memory" section (persona.md lines 5-17). Starts with `## Before You Act — Check Your Memory` and ends with the paragraph about saving corrections to `self` document. Include the paragraph about discord threads at line 7 ("Discord threads and scheduled tasks...") and the numbered list.

2. `TOOL_CALLING_SECTION` — the "How You Call Tools" section (persona.md lines 19-62). Starts with `# How You Call Tools — READ THIS CAREFULLY`. Contains subsections for sandbox tools, native tools, common mistakes, and batching. Include the `{native_tools_list}` placeholder in the native tools subsection where the current hardcoded tool list appears (lines 41-45). The placeholder replaces the specific tool names so they can be injected at build time.

3. `DOCUMENTS_SECTION` — the "Documents — Your Memory System" section (persona.md lines 64-110). Starts with `## Documents — Your Memory System`. Contains conventional rkeys, tools, what to save, document format, and rules.

4. `CHAINING_SECTION` — the "Chaining Tool Calls" section (persona.md lines 251-256). Starts with `## Chaining Tool Calls`.

5. `ERROR_HANDLING_SECTION` — the "Error Handling" section (persona.md lines 258-261). Starts with `## Error Handling`.

**Dynamic templates** — these contain `{placeholder}` tokens that are interpolated at build time:

6. `CURRENT_TIME_TEMPLATE` — matches the current time section in `context.ts:28-39`. Template:
```
## Current Time
{formatted_time} ({timezone})

All times you present to the user MUST be in {timezone}. Never use UTC unless explicitly asked.
```

7. `SELF_DOC_TEMPLATE` — matches the self doc injection in `context.ts:42-44`. Template:
```
## Your Memory (auto-loaded)
This is your saved identity and memory:

{self_doc}
```

8. `RECALLED_CONTEXT_TEMPLATE` — matches the recalled context section in `context.ts:47-52`. Template:
```
## Recalled Context
{fragments}
```

9. `SKILLS_LIST_TEMPLATE` — two variants matching `context.ts:54-62`:
   - Empty variant: `No skills saved yet. You can save working code as reusable skills with doc_upsert using a \`skill:<name>\` rkey.`
   - Non-empty variant: `You can run these saved skills. Use doc_get to load skill content before running:\n{skills}`

10. `TOOL_DOCS_TEMPLATE` — matches `context.ts:64-67`. Template:
```
## Tool Reference

Tools marked with `tools.<name>` are available **only inside TypeScript code you run via `execute_code`.** Call them as `await tools.<method>({...})`. Tools marked *(direct tool call)* are called directly — do NOT use execute_code for those.

{tool_docs}
```

11. `CUSTOM_TOOLS_TEMPLATE` — the custom tools availability notice, containing `{secret_names}` placeholder for listing which secrets the user has configured. This is distinct from the custom tools LIST — this is the instructional text about creating/managing custom tools.

12. `CUSTOM_TOOLS_LIST_TEMPLATE` — matches the custom tools listing in `agent.ts:242-249`. Template:
```
## Custom Tools (call via tools.call_custom_tool)

{custom_tools_list}
```

**Export the `SystemPromptParams` type:**

```typescript
export type SystemPromptParams = {
  readonly selfDoc: string;
  readonly skillNames: ReadonlyArray<string>;
  readonly toolDocs?: string;
  readonly timezone?: string;
  readonly recalledContext?: ReadonlyArray<RecalledContextEntry>;
  readonly customToolSummaries?: ReadonlyArray<{ name: string; description: string }>;
  readonly secretNames?: ReadonlyArray<string>;
  readonly nativeToolNames?: ReadonlyArray<string>;
};
```

Import `RecalledContextEntry` from `./types.ts`.

**Export the `buildSystemPrompt()` function:**

The function accepts `SystemPromptParams` and assembles sections in this order:
1. `MEMORY_CHECK_SECTION`
2. `TOOL_CALLING_SECTION` — interpolate `{native_tools_list}` with formatted native tool names from `params.nativeToolNames`. If not provided or empty, keep the "Native tools" subsection but omit the "Currently:" bullet list (the instructional text about how native tools work should always be present).
3. `DOCUMENTS_SECTION`
4. `CHAINING_SECTION`
5. `ERROR_HANDLING_SECTION`
6. Current time — format `new Date()` using `toLocaleString('en-US', ...)` with the `timezone` param (default `'UTC'`), matching the exact format in `context.ts:29-38`. Interpolate into `CURRENT_TIME_TEMPLATE`.
7. Self doc — if `selfDoc` is non-empty, interpolate into `SELF_DOC_TEMPLATE`. If empty, include the section header with empty content (per AC2.6).
8. Recalled context — if `recalledContext` is provided and non-empty, format each entry as `### {rkey}\n{content}` joined by `\n\n`, then interpolate into `RECALLED_CONTEXT_TEMPLATE`. If empty/undefined, omit entirely.
9. Skills list — use `SKILLS_LIST_TEMPLATE`. If `skillNames` is empty, use the empty variant. Otherwise format as `- {name}` per skill.
10. Tool docs — if `toolDocs` is provided and non-empty, interpolate into `TOOL_DOCS_TEMPLATE`. If empty/undefined, omit entirely.
11. Custom tools template — always include the instructional text. If `secretNames` is provided, interpolate into `CUSTOM_TOOLS_TEMPLATE`.
12. Custom tools list — if `customToolSummaries` is provided and non-empty, format each as `- **{name}** — {description}` and interpolate into `CUSTOM_TOOLS_LIST_TEMPLATE`. If empty/undefined, omit entirely.

Join all included sections with `\n`.

**Key details:**
- The file imports only `RecalledContextEntry` from `./types.ts` — no other imports
- No I/O (no `Bun.file`, no `fetch`, no store access)
- `Date` construction is the only side effect (acceptable for a time-aware prompt builder)
- Follow the module-private constant pattern from `src/tools/summarize.ts` and `src/agent/session-title.ts`

**Verification:**

Run: `bun run build`
Expected: Build succeeds with no type errors

**Commit:** `feat(prompt): create prompt.ts with template constants and buildSystemPrompt()`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/agent/prompt.test.ts`

**Verifies:** prompt-templates.AC6.1, prompt-templates.AC6.2, prompt-templates.AC6.3, prompt-templates.AC6.4, prompt-templates.AC1.4, prompt-templates.AC2.3, prompt-templates.AC2.4, prompt-templates.AC2.5, prompt-templates.AC2.6

**Files:**
- Create: `src/agent/prompt.test.ts`

**Implementation:**

Create test file annotated with `// pattern: Imperative Shell (test) — exercises prompt builder with various param combinations`.

Use `bun:test` with `describe`/`test`/`expect` imports. Define a helper function that returns minimal valid `SystemPromptParams`:

```typescript
function makeParams(overrides?: Partial<SystemPromptParams>): SystemPromptParams {
  return {
    selfDoc: '',
    skillNames: [],
    ...overrides,
  };
}
```

**Testing:**

Tests must verify each AC listed above:

- **prompt-templates.AC6.1 (template block inclusion/exclusion):**
  - Test that all static sections (memory check, tool calling, documents, chaining, error handling) are always present in output
  - Test that current time section is always present
  - Test that skills section is always present (empty or populated variant)
  - Test that recalled context section is absent when `recalledContext` is undefined
  - Test that recalled context section is absent when `recalledContext` is empty array
  - Test that recalled context section is present when `recalledContext` has entries
  - Test that tool docs section is absent when `toolDocs` is undefined
  - Test that tool docs section is present when `toolDocs` is provided
  - Test that custom tools list section is absent when `customToolSummaries` is undefined
  - Test that custom tools list section is absent when `customToolSummaries` is empty array
  - Test that custom tools list section is present when `customToolSummaries` has entries

- **prompt-templates.AC6.2 (conditional blocks):**
  - Test recalled context appears/disappears based on params (covered above)
  - Test custom tools list appears/disappears based on params (covered above)
  - Test skills section shows empty message when `skillNames` is `[]`
  - Test skills section lists skills when `skillNames` has entries

- **prompt-templates.AC6.3 (interpolation of dynamic placeholders):**
  - Test that `{timezone}` is replaced with provided timezone value
  - Test that `{timezone}` defaults to `'UTC'` when not provided
  - Test that native tool names are interpolated into tool calling section when provided
  - Test that self doc content is interpolated into self doc section
  - Test that recalled context entries are formatted as `### {rkey}\n{content}`
  - Test that custom tool summaries are formatted as `- **{name}** — {description}`
  - Test that secret names are interpolated when provided

- **prompt-templates.AC6.4 (assembly order):**
  - Test that sections appear in the correct order: memory check → tool calling → documents → chaining → error handling → current time → self doc → recalled context → skills → tool docs → custom tools template → custom tools list
  - Use `indexOf()` comparisons on the output to verify relative ordering

- **prompt-templates.AC2.6 (empty selfDoc):**
  - Test that when `selfDoc` is `''`, the self doc section header still appears but with empty content
  - Test that the overall prompt is still valid (no syntax errors, no missing sections)

- **prompt-templates.AC1.4 (build succeeds):**
  - Verified by the tests compiling and running — if template constants reference removed symbols, compilation will fail

Follow project testing patterns: manual factory helpers, `expect()` assertions, `describe`/`test` blocks. No external mocking libraries.

**Verification:**

Run: `bun test src/agent/prompt.test.ts`
Expected: All tests pass

**Commit:** `test(prompt): add tests for template blocks, conditionals, interpolation, and assembly order`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
