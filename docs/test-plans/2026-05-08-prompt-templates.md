# Prompt Templates — Human Test Plan

## Prerequisites
- Environment: local dev machine with `bun` installed
- `bun test` passing (106 tests, 0 failures)
- Project built successfully with `bun run build`

## Phase 1: Template Extraction Verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `ls src/agent/prompt.ts` | File exists |
| 2 | Open `src/agent/prompt.ts` and scan for `const` declarations at module scope | Multiple `const` template strings exist (MEMORY_CHECK_SECTION, TOOL_CALLING_SECTION, DOCUMENTS_SECTION, etc.), none are exported |
| 3 | Run `ls persona.md 2>&1` | "No such file or directory" — persona.md has been deleted (AC1.3) |
| 4 | Run `grep -r "persona" src/ --include="*.ts" --include="*.tsx" -l` | No results referencing persona.md as a file path. `seed-self-doc.ts` may reference "seeded-from-persona" marker string — that is acceptable. |

## Phase 2: Integration Wiring Verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `grep -n "systemPromptProvider\|PERSONA_PATH" src/index.ts` | No results (AC3.2) |
| 2 | Run `grep -n "customTool\|getApprovedToolSummaries" src/tui/App.tsx` | Custom tool summaries are passed as a param to `buildSystemPrompt()`, not appended separately (AC3.3) |
| 3 | Run `grep -rn "Bun.file.*persona" src/ --include="*.ts" --include="*.tsx"` | No results (AC5.3) |
| 4 | Run `grep -rn "persona\.md" src/ --include="*.ts" --include="*.tsx"` | No results (AC5.3) |

## Phase 3: Live System Prompt Inspection

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun start` | TUI launches without errors |
| 2 | Press `p` to open the System Prompt screen | System prompt displays |
| 3 | Verify the prompt begins with "## Before You Act — Check Your Memory" | Memory check section present at top |
| 4 | Scroll through the prompt and verify section ordering: Memory Check -> Tool Calling -> Documents -> Chaining -> Error Handling -> Current Time -> Your Memory -> Available Skills -> Custom Tools | Sections appear in this order |
| 5 | Verify "## Your Memory (auto-loaded)" section contains the self doc content (or is empty if first run) | Section present with correct content |
| 6 | Verify timezone appears in "## Current Time" section | Shows system timezone, not `{timezone}` placeholder |
| 7 | Press `Escape` to return to sessions | Navigation works |

## Phase 4: Self-Doc Seeding Verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start with a fresh database: `rm data/constellation.db` then `bun start` | Agent launches, self doc seeded on first run |
| 2 | Press `p` to view system prompt | "Your Memory" section contains seeded content including "Johnson", "general-purpose AI agent" |
| 3 | Stop the agent, then restart with `bun start` | Agent launches again |
| 4 | Press `p` to view system prompt | Content is identical to step 2 — no duplication from second run |

## End-to-End: Full Prompt Assembly with All Optional Sections

**Purpose:** Validates that all conditional sections render correctly in a real agent session with recall enabled and custom tools present.

1. Configure `config.toml` with `recall_enabled = true` and ensure embedding provider is configured
2. Start the agent with `bun start`
3. Create a custom tool by asking the agent: "Create a custom tool called test-weather that returns 'sunny'"
4. Approve the custom tool via the Tools screen (press `t`)
5. Ask the agent a knowledge-related question that would trigger recall
6. Press `p` to view the system prompt
7. Verify all sections are present: static sections + Recalled Context + Custom Tools list + Tool Reference
8. Verify no raw placeholder strings (`{timezone}`, `{fragments}`, `{secret_names}`, etc.) appear anywhere

## End-to-End: Build Integrity After Persona Removal

1. Run `bun run build` — should complete without errors
2. Run `bun test` — all tests pass (106 tests, 0 failures)
3. Run `bun start` — agent launches and responds to messages without errors
4. Send a test message like "hello" — agent responds normally using the new prompt builder

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| prompt-templates.AC1.1 | `prompt.test.ts` — static sections tests | — |
| prompt-templates.AC1.2 | `prompt.test.ts` — static sections tests | — |
| prompt-templates.AC1.3 | — | Phase 1, Steps 3-4 |
| prompt-templates.AC1.4 | `prompt.test.ts` — compilation test | — |
| prompt-templates.AC2.1 | `prompt.test.ts` — import proves export | — |
| prompt-templates.AC2.2 | `prompt.test.ts` — no I/O mocks needed | — |
| prompt-templates.AC2.3 | `prompt.test.ts` — optional params omission | — |
| prompt-templates.AC2.4 | `prompt.test.ts` — assembly order | — |
| prompt-templates.AC2.5 | `prompt.test.ts` — dynamic placeholders | — |
| prompt-templates.AC2.6 | `prompt.test.ts` — empty selfDoc | — |
| prompt-templates.AC3.1 | `agent.test.ts` — no systemPromptProvider in deps | — |
| prompt-templates.AC3.2 | — | Phase 2, Step 1 |
| prompt-templates.AC3.3 | — | Phase 2, Step 2; Phase 3 |
| prompt-templates.AC3.4 | `agent.test.ts`, `tools.test.ts` — no personaPath | — |
| prompt-templates.AC4.1 | `prompt.test.ts` — custom tool summaries | — |
| prompt-templates.AC4.2 | `prompt.test.ts` — empty custom tools | — |
| prompt-templates.AC4.3 | `prompt.test.ts` — secret names | — |
| prompt-templates.AC5.1 | `agent.test.ts` — compilation | — |
| prompt-templates.AC5.2 | Build-time (`bun run build`) | — |
| prompt-templates.AC5.3 | — | Phase 2, Steps 3-4 |
| prompt-templates.AC6.1 | `prompt.test.ts` — block inclusion/exclusion | — |
| prompt-templates.AC6.2 | `prompt.test.ts` — conditional blocks | — |
| prompt-templates.AC6.3 | `prompt.test.ts` — interpolation | — |
| prompt-templates.AC6.4 | `prompt.test.ts` — assembly order | — |
| prompt-templates.AC6.5 | `context.test.ts` deleted, build passes | — |
| prompt-templates.AC7.1 | `seed-self-doc.test.ts` — first run | Phase 4, Steps 1-2 |
| prompt-templates.AC7.2 | `seed-self-doc.test.ts` — no clobber | — |
| prompt-templates.AC7.3 | `seed-self-doc.test.ts` — no duplication | Phase 4, Steps 3-4 |
