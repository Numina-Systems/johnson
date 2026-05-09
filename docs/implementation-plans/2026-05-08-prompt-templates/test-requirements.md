# Test Requirements: Prompt Templates

## Automated Tests

| AC ID | Criterion | Test Type | Test File | Phase |
|-------|-----------|-----------|-----------|-------|
| prompt-templates.AC1.1 | `src/agent/prompt.ts` exists with module-private template constants for each system prompt concern | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC1.2 | Each constant contains the exact text from its corresponding persona.md section (no content changes) | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC1.4 | Build fails if any template constant references a removed symbol or import | unit | `src/agent/prompt.test.ts` (compilation is the test — if tests compile and run, this passes) | 1 |
| prompt-templates.AC2.1 | `buildSystemPrompt(params: SystemPromptParams)` exported from `src/agent/prompt.ts` | unit | `src/agent/prompt.test.ts` (import and invocation proves export exists) | 1 |
| prompt-templates.AC2.2 | Function is pure — no I/O, no store access, no file reads | unit | `src/agent/prompt.test.ts` (function runs with no deps beyond params; no mocks needed for I/O) | 1 |
| prompt-templates.AC2.3 | Optional params (recalledContext, customToolSummaries, toolDocs) are omitted from output when empty/undefined | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC2.4 | Assembly order matches the specified sequence (memory check through custom tools list) | unit | `src/agent/prompt.test.ts` (indexOf ordering assertions) | 1 |
| prompt-templates.AC2.5 | Dynamic placeholders ({timezone}, {native_tools_list}, {secret_names}) interpolated correctly | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC2.6 | Empty selfDoc still produces valid prompt (section present but empty content) | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC3.1 | `src/agent/agent.ts` calls `buildSystemPrompt()` directly without `buildInlinePrompt()` or `systemPromptProvider` | integration | `src/agent/agent.test.ts` (mock deps no longer include systemPromptProvider; agent still builds prompt) | 2 |
| prompt-templates.AC3.4 | No references to `personaPath` remain in `AgentDependencies` or `TuiDependencies` | unit | `src/agent/agent.test.ts`, `src/agent/tools.test.ts` (mock deps compile without personaPath) | 2 |
| prompt-templates.AC4.1 | `customToolSummaries` param renders approved tools in the prompt | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC4.2 | Empty `customToolSummaries` omits the custom tools list section | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC4.3 | `secretNames` param renders available secret names in the custom tools template | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC5.1 | `AgentDependencies` in `src/agent/types.ts` has no `personaPath` field | unit | `src/agent/agent.test.ts` (compilation fails if field referenced incorrectly) | 2 |
| prompt-templates.AC5.2 | `TuiDependencies` in `src/tui/types.ts` has no `personaPath` field | unit | Verified at compile time (`bun run build`) | 2 |
| prompt-templates.AC6.1 | `src/agent/prompt.test.ts` tests each template block inclusion/exclusion | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC6.2 | Tests verify conditional blocks (recalled context, custom tools, skills) appear/disappear based on params | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC6.3 | Tests verify interpolation of dynamic placeholders | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC6.4 | Tests verify assembly order | unit | `src/agent/prompt.test.ts` | 1 |
| prompt-templates.AC6.5 | Old `buildSystemPrompt` tests in `context.test.ts` removed (no dead tests) | unit | Verified by deletion of `src/agent/context.test.ts` (build + test suite passes without it) | 2 |
| prompt-templates.AC7.1 | On first run with empty self doc, identity + domain knowledge content is seeded | integration | `src/agent/seed-self-doc.test.ts` (in-memory SQLite store) | 3 |
| prompt-templates.AC7.2 | On run with existing self doc content, seeding appends without clobbering | integration | `src/agent/seed-self-doc.test.ts` (in-memory SQLite store) | 3 |
| prompt-templates.AC7.3 | On run where self doc already contains seeded content, no duplication occurs | integration | `src/agent/seed-self-doc.test.ts` (in-memory SQLite store) | 3 |

## Human Verification

| AC ID | Criterion | Why Not Automated | Verification Approach |
|-------|-----------|-------------------|----------------------|
| prompt-templates.AC1.3 | `persona.md` is deleted from the repository | File deletion is a repo state assertion, not a behavioural test. A test that checks for file absence is brittle and adds no value beyond `ls`. | Run `ls persona.md` after Phase 3 Task 3. Confirm "No such file or directory". Verify `grep -r "persona" src/ --include="*.ts" --include="*.tsx" -l` returns no results. |
| prompt-templates.AC3.2 | `src/index.ts` has no `systemPromptProvider` callback or `PERSONA_PATH` constant | Static code property (absence of specific symbols), not runtime behaviour. | Run `grep -n "systemPromptProvider\|PERSONA_PATH" src/index.ts`. Confirm no results. Visually inspect `src/index.ts` to confirm no persona file reading or provider callback. |
| prompt-templates.AC3.3 | `src/tui/App.tsx` calls `buildSystemPrompt()` directly without separate custom tools appending | TUI prompt display is interactive. Custom tools appending removal is structural — final prompt content is identical. | Run `grep -n "customTool\|getApprovedToolSummaries" src/tui/App.tsx`. Confirm custom tools are passed as a param to `buildSystemPrompt()`, not appended separately. Run `bun start` and press `p` to view system prompt screen. |
| prompt-templates.AC5.3 | No `Bun.file()` calls for persona content anywhere in codebase | Static code property — testing for absence of a pattern across all files is grep, not a test. | Run `grep -rn "Bun.file.*persona" src/ --include="*.ts" --include="*.tsx"`. Confirm no results. Run `grep -rn "persona\.md" src/ --include="*.ts" --include="*.tsx"`. Confirm no results. |
