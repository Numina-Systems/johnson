# Prompt Templates Design

## Summary

This design replaces a runtime-loaded markdown file (`persona.md`) and three separate prompt-assembly callsites with a single typed `buildSystemPrompt()` function in a new `src/agent/prompt.ts` module. Currently, the agent's system prompt is built by reading `persona.md` from disk and then ad-hoc assembling additional sections at multiple points in the codebase — once in `agent.ts`, once in `index.ts`, and once in `App.tsx` — each with slightly different logic for appending things like custom tool listings. The new approach moves all static prompt content into module-private TypeScript constants, parameterises the dynamic parts (current time, recalled context, tool documentation, custom tools) behind a typed `SystemPromptParams` interface, and makes the function pure: no I/O, no store access, just string assembly.

Content from `persona.md` falls into one of three destinations: universal agent behaviour (memory checks, tool-calling rules, document conventions, error handling) becomes template constants in `prompt.ts`; identity and domain knowledge (the agent's name, Obsidian vault workflow, scheduling conventions, skill conventions) migrates into the `self` document in the SQLite store so the agent can read and edit it at runtime; and tool signatures duplicated from the tool registry's own generated documentation are simply removed. A one-time self-doc seeding step in `main()` handles the migration for existing installations without clobbering content the agent may have already written.

## Definition of Done

1. **persona.md is eliminated** — its content is decomposed into named template constants in a new `src/agent/prompt.ts` module, each covering one concern (identity, tool-calling instructions, document conventions, web tools, skills, scheduling, obsidian vault, custom tools, error handling)
2. **Single typed build function** — `buildSystemPrompt()` takes a typed params object and assembles all blocks, replacing the current procedural assembly
3. **Three duplicated callsites consolidated** — `index.ts`, `agent.ts` fallback, and `App.tsx` all call the same build function instead of each reimplementing the logic
4. **Custom tools listing integrated** — no more ad-hoc appending in `agent.ts:242-249` and `App.tsx:47-55`; it's a parameter to the build function
5. **`personaPath` removed from deps** — templates live in code, not read from disk at runtime
6. **Existing tests updated** — `context.test.ts` tests updated to match new structure, with additional coverage for individual template blocks
7. **No content changes** — the actual prompt instructions stay the same, just reorganised

## Acceptance Criteria

### prompt-templates.AC1: persona.md content decomposed into template constants
- **prompt-templates.AC1.1 Success:** `src/agent/prompt.ts` exists with module-private template constants for each system prompt concern
- **prompt-templates.AC1.2 Success:** Each constant contains the exact text from its corresponding persona.md section (no content changes)
- **prompt-templates.AC1.3 Success:** `persona.md` is deleted from the repository
- **prompt-templates.AC1.4 Failure:** Build fails if any template constant references a removed symbol or import

### prompt-templates.AC2: Single typed build function
- **prompt-templates.AC2.1 Success:** `buildSystemPrompt(params: SystemPromptParams)` exported from `src/agent/prompt.ts`
- **prompt-templates.AC2.2 Success:** Function is pure — no I/O, no store access, no file reads
- **prompt-templates.AC2.3 Success:** Optional params (recalledContext, customToolSummaries, toolDocs) are omitted from output when empty/undefined
- **prompt-templates.AC2.4 Success:** Assembly order matches the specified sequence (memory check through custom tools list)
- **prompt-templates.AC2.5 Success:** Dynamic placeholders ({timezone}, {native_tools_list}, {secret_names}) interpolated correctly
- **prompt-templates.AC2.6 Failure:** Empty selfDoc still produces valid prompt (section present but empty content)

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

### prompt-templates.AC6: Tests updated
- **prompt-templates.AC6.1 Success:** `src/agent/prompt.test.ts` tests each template block inclusion/exclusion
- **prompt-templates.AC6.2 Success:** Tests verify conditional blocks (recalled context, custom tools, skills) appear/disappear based on params
- **prompt-templates.AC6.3 Success:** Tests verify interpolation of dynamic placeholders
- **prompt-templates.AC6.4 Success:** Tests verify assembly order
- **prompt-templates.AC6.5 Success:** Old `buildSystemPrompt` tests in `context.test.ts` removed (no dead tests)

### prompt-templates.AC7: Self doc seeding
- **prompt-templates.AC7.1 Success:** On first run with empty self doc, identity + domain knowledge content is seeded
- **prompt-templates.AC7.2 Success:** On run with existing self doc content, seeding appends without clobbering
- **prompt-templates.AC7.3 Edge:** On run where self doc already contains seeded content, no duplication occurs

## Glossary

- **`persona.md`**: A markdown file currently read from disk at startup that provides the agent's identity, behavioural rules, and tool guidance as a flat system prompt prefix. This design eliminates it.
- **System prompt**: The hidden instruction block prepended to every conversation that defines agent behaviour, persona, and capabilities. Not visible to end users.
- **Template constant**: A module-private TypeScript string constant (`UPPER_SNAKE_CASE`) holding a fixed section of the system prompt. Private to the module — not exported.
- **`buildSystemPrompt()`**: The single exported pure function that assembles all template constants and dynamic parameters into a complete system prompt string.
- **`SystemPromptParams`**: The typed interface passed to `buildSystemPrompt()`, capturing all runtime-variable inputs (self doc content, recalled context, tool docs, etc.).
- **Functional Core**: A codebase pattern (annotated `// pattern: Functional Core`) for modules containing only pure functions — no I/O, no side effects, no store access. `prompt.ts` follows this pattern.
- **`self` document**: A special persistent document stored under the `self` rkey in the SQLite store. Loaded automatically into the system prompt every turn. The agent can read and write it, making it the appropriate home for runtime-editable identity and domain knowledge.
- **rkey**: "Record key" — the primary key used to address documents in the store. Conventional prefixes (`self`, `skill:`, `task:`, `archive:`) provide namespace structure.
- **Tool registry (`toolDocs`)**: The auto-generated markdown documentation produced by the tool registry for each registered tool. Currently duplicated in `persona.md`; this design removes the duplication.
- **`customToolSummaries`**: The output of `getApprovedToolSummaries()` — an array of `{ name, description }` objects for user-created tools that have been hash-approved. Passed as a param to `buildSystemPrompt()`.
- **Reflexive recall / recalled context**: The automatic retrieval of relevant knowledge fragments from the store before each chat turn (when `recallEnabled` is true). Injected into the system prompt as a `## Recalled Context` section.
- **Self-doc seeding**: A one-time migration step in `main()` that writes identity and domain knowledge content into the `self` document on first startup after the refactor, so existing installations aren't left with an empty self doc.
- **Callsite**: A location in the codebase that calls a particular function. The design consolidates three separate prompt-assembly callsites into one shared `buildSystemPrompt()` call.
- **Interpolation**: Replacing `{placeholder}` tokens inside a template string with runtime values (e.g. `{timezone}`, `{native_tools_list}`).

## Architecture

Decompose the monolithic `persona.md` and procedural prompt assembly into a template-based composition pattern. A new `src/agent/prompt.ts` module (Functional Core) contains named template constants and a single `buildSystemPrompt()` function that assembles them.

### Content Placement

persona.md content moves to three destinations based on what it actually is:

| Content | Current Location | Destination | Rationale |
|---------|-----------------|-------------|-----------|
| "Before You Act" memory check | persona.md lines 5-22 | Template constant in `prompt.ts` | Universal agent behaviour |
| Tool calling instructions (execute_code, native, batching, mistakes) | persona.md lines 23-63 | Template constant in `prompt.ts` | Universal agent behaviour |
| Document conventions (rkeys, doc tools, what to save, format) | persona.md lines 64-110 | Template constant in `prompt.ts` | Universal agent behaviour |
| Chaining guidance | persona.md lines 251-257 | Template constant in `prompt.ts` | Universal agent behaviour |
| Error handling | persona.md lines 258-261 | Template constant in `prompt.ts` | Universal agent behaviour |
| Identity paragraph (name, personality) | persona.md lines 1-4 | `self` document in store | Runtime-editable identity |
| Obsidian vault workflow | persona.md lines 170-186 | `self` document in store | Domain knowledge, not system instructions |
| Scheduled tasks conventions | persona.md lines 201-250 | `self` document in store | Domain knowledge, not system instructions |
| Skill conventions | persona.md lines 187-200 | `self` document in store | Domain knowledge, not system instructions |
| Web tools signatures | persona.md lines 111-118 | Removed (covered by tool registry `toolDocs`) | Duplicate of generated documentation |
| Notify tools signatures | persona.md lines 119-122 | Removed (covered by tool registry `toolDocs`) | Duplicate of generated documentation |
| Image/summarize signatures | persona.md lines 123-129 | Removed (covered by tool registry `toolDocs`) | Duplicate of generated documentation |
| File ingestion signatures | persona.md lines 130-159 | Removed (covered by tool registry `toolDocs`) | Duplicate of generated documentation |
| Custom tools signatures | persona.md lines 160-169 | Removed (covered by tool registry `toolDocs`) | Duplicate of generated documentation |

### Template Constants

Module-private constants in `src/agent/prompt.ts`, following codebase convention (`UPPER_SNAKE_CASE`, no export):

**Static sections** (no interpolation):
- `MEMORY_CHECK_SECTION`
- `TOOL_CALLING_SECTION` — includes `{native_tools_list}` placeholder for native tool names
- `DOCUMENTS_SECTION`
- `CHAINING_SECTION`
- `ERROR_HANDLING_SECTION`

**Dynamic templates** (interpolated at build time):
- `CURRENT_TIME_TEMPLATE` — `{formatted_time}`, `{timezone}`
- `SELF_DOC_TEMPLATE` — `{self_doc}`
- `RECALLED_CONTEXT_TEMPLATE` — `{fragments}`
- `SKILLS_LIST_TEMPLATE` — `{skills}`
- `TOOL_DOCS_TEMPLATE` — `{tool_docs}`
- `CUSTOM_TOOLS_TEMPLATE` — `{secret_names}`
- `CUSTOM_TOOLS_LIST_TEMPLATE` — `{custom_tools_list}`

### Build Function Contract

```typescript
export interface SystemPromptParams {
  readonly selfDoc: string;
  readonly skillNames: ReadonlyArray<string>;
  readonly toolDocs?: string;
  readonly timezone?: string;
  readonly recalledContext?: ReadonlyArray<RecalledContextEntry>;
  readonly customToolSummaries?: ReadonlyArray<{ name: string; description: string }>;
  readonly secretNames?: ReadonlyArray<string>;
  readonly nativeToolNames?: ReadonlyArray<string>;
}

export function buildSystemPrompt(params: SystemPromptParams): string;
```

Assembly order:
1. `MEMORY_CHECK_SECTION`
2. `TOOL_CALLING_SECTION` (with `nativeToolNames` interpolated)
3. `DOCUMENTS_SECTION`
4. `CHAINING_SECTION`
5. `ERROR_HANDLING_SECTION`
6. `CURRENT_TIME_TEMPLATE`
7. `SELF_DOC_TEMPLATE`
8. `RECALLED_CONTEXT_TEMPLATE` (omitted if empty)
9. `SKILLS_LIST_TEMPLATE`
10. `TOOL_DOCS_TEMPLATE` (omitted if no toolDocs)
11. `CUSTOM_TOOLS_TEMPLATE`
12. `CUSTOM_TOOLS_LIST_TEMPLATE` (omitted if no approved tools)

### Callsite Consolidation

Three duplicated callsites collapse to direct `buildSystemPrompt()` calls:

**`src/agent/agent.ts`:**
- Remove `buildInlinePrompt()` closure (lines 212-222)
- Remove `systemPromptProvider` callback usage (lines 224-239)
- `chat()` gathers params from deps and calls `buildSystemPrompt()` directly
- Custom tools appending (lines 242-249) moves into params

**`src/index.ts`:**
- Remove `systemPromptProvider` callback (lines 113-124)
- Remove `PERSONA_PATH` constant (line 34) and file read
- Remove `personaPath` from `agentDeps` (line 141)

**`src/tui/App.tsx`:**
- Simplify `getSystemPrompt()` (lines 31-58) to call `buildSystemPrompt()` directly
- Remove custom tools appending (lines 47-55)

**`src/agent/types.ts` (`AgentDependencies`):**
- Remove `personaPath: string` (line 52)
- Remove `systemPromptProvider` callback (lines 60-63)

**`src/tui/types.ts` (`TuiDependencies`):**
- Remove `systemPromptProvider` callback (line 20)
- Remove `personaPath` (line 23)

### Self Doc Seeding

On startup, `main()` in `src/index.ts` checks whether the `self` document contains the migrated content. If it's empty or missing, seed it with:
- Identity paragraph (from persona.md lines 1-4)
- Obsidian vault workflow (from persona.md lines 170-186)
- Scheduled tasks conventions (from persona.md lines 201-250)
- Skill conventions (from persona.md lines 187-200)

The seeding is additive — if the self doc already has content, append a separator and the missing sections. This is a one-time migration; the agent can modify this content at runtime going forward.

## Existing Patterns

Investigation found the following patterns this design follows:

- **Module-private constants**: `src/tools/summarize.ts` and `src/agent/session-title.ts` both define prompt-related constants as module-private `UPPER_SNAKE_CASE` — not exported. This design follows the same convention.
- **Functional Core pattern**: `src/agent/context.ts` is annotated `// pattern: Functional Core` and contains pure functions. The new `src/agent/prompt.ts` follows this pattern — no I/O, no store access.
- **`RecalledContextEntry` type**: Already defined in `src/agent/types.ts` (lines 5-9) with `rkey` and `content` fields. Reused directly in `SystemPromptParams`.
- **Custom tool summary shape**: `getApprovedToolSummaries()` in `src/tools/custom-tool-manager.ts` returns `Array<{ name: string; description: string }>`. The `SystemPromptParams.customToolSummaries` field matches this shape exactly.

No divergence from existing patterns.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Create prompt.ts with template constants and build function
**Goal:** New module with all template constants extracted from persona.md and a typed `buildSystemPrompt()` function

**Components:**
- `src/agent/prompt.ts` — template constants + `SystemPromptParams` interface + `buildSystemPrompt()` function
- `src/agent/prompt.test.ts` — tests for individual template blocks, conditional sections, interpolation, assembly order

**Dependencies:** None (first phase)

**Done when:** `buildSystemPrompt()` produces output equivalent to the current assembly for the same inputs. All new tests pass. `bun run build` succeeds.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Consolidate callsites
**Goal:** All three prompt assembly sites use the new `buildSystemPrompt()` from `prompt.ts`

**Components:**
- `src/agent/agent.ts` — remove `buildInlinePrompt()` closure, remove `systemPromptProvider` usage, call `buildSystemPrompt()` directly, move custom tools into params
- `src/index.ts` — remove `systemPromptProvider` callback, remove `PERSONA_PATH`, remove `personaPath` from `agentDeps`
- `src/tui/App.tsx` — simplify `getSystemPrompt()` to call `buildSystemPrompt()` directly, remove custom tools appending
- `src/agent/types.ts` — remove `personaPath` and `systemPromptProvider` from `AgentDependencies`
- `src/tui/types.ts` — remove `systemPromptProvider` and `personaPath` from `TuiDependencies`
- `src/agent/index.ts` — update barrel exports (remove old `buildSystemPrompt` re-export from context.ts, add new one from prompt.ts)

**Dependencies:** Phase 1

**Done when:** All three callsites use the new function. No references to `personaPath` or `systemPromptProvider` remain. Existing tests in `context.test.ts` updated for new signature. `bun test` passes. `bun run build` succeeds.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Seed self doc and remove persona.md
**Goal:** Domain knowledge migrated to the self document. persona.md deleted.

**Components:**
- `src/index.ts` — add self-doc seeding logic in `main()` that checks for and appends identity, obsidian vault, scheduling, and skill convention content
- `persona.md` — deleted
- `src/agent/context.ts` — `loadCoreMemoryFromStore()` unchanged (already loads self doc)

**Dependencies:** Phase 2

**Done when:** Agent starts with correct self doc content (seeded on first run). persona.md no longer exists. No file reads for persona content anywhere. `bun test` passes. `bun run build` succeeds.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Cleanup and verify
**Goal:** Remove dead code, verify end-to-end prompt output matches expectations

**Components:**
- `src/agent/context.ts` — remove the old `buildSystemPrompt()` function (now in prompt.ts). Keep `loadCoreMemoryFromStore()`, `estimateTokens()`, `repairConversation()`, `trimOldToolResults()`, `shouldTruncate()`
- `src/agent/context.test.ts` — remove tests for old `buildSystemPrompt()` signature (covered by new `prompt.test.ts`)
- Verify no remaining imports of removed symbols

**Dependencies:** Phase 3

**Done when:** No dead code remains. All tests pass. `bun run build` succeeds. `bun start` launches correctly.
<!-- END_PHASE_4 -->

## Additional Considerations

**Self doc size:** Migrating identity, obsidian vault, scheduling, and skill conventions into the self doc increases its token cost (it's auto-loaded every turn). The content is ~100 lines. This is acceptable because (a) the system prompt shrinks by more than that amount (removing duplicate tool signatures), and (b) the agent can edit or trim the self doc over time, which it couldn't do with persona.md.

**Tool signature deduplication:** Removing per-tool signature sections from the system prompt assumes the tool registry's `toolDocs` output is sufficient. If any tool-specific guidance (beyond signatures) was in persona.md, it should be preserved. The file ingestion section, for example, contains guidance about pandoc conversion and intent inference that goes beyond a signature — this should move to the self doc alongside the other domain knowledge, not be silently dropped.
