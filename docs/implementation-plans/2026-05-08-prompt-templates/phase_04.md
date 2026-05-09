# Prompt Templates Implementation Plan — Phase 4

**Goal:** Remove dead code from `context.ts`, verify no remaining imports of removed symbols. Clean end state.

**Architecture:** Remove the old `buildSystemPrompt()` function and its unused import from `context.ts`. `context.test.ts` was already deleted in Phase 2. Verify the build is clean and all tests pass.

**Tech Stack:** TypeScript, bun:test

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-05-08

---

## Acceptance Criteria Coverage

This phase verifies the final clean state. No new ACs — all ACs are covered by Phases 1-3. This is infrastructure cleanup.

---

<!-- START_TASK_1 -->
### Task 1: Remove old `buildSystemPrompt()` from `context.ts`

**Verifies:** None (infrastructure cleanup)

**Files:**
- Modify: `src/agent/context.ts:5` (remove unused import)
- Modify: `src/agent/context.ts:17-70` (remove old function)

**Implementation:**

In `src/agent/context.ts`:

1. **Remove the `RecalledContextEntry` import** (line 5): `import type { RecalledContextEntry } from './types.ts';`
   — This type is only used by the old `buildSystemPrompt` signature. After removing the function, the import is dead. No other function in `context.ts` uses it.

2. **Remove the old `buildSystemPrompt()` function** (lines 17-70): The entire function from `export function buildSystemPrompt(` through the closing `}` and the `return sections.join('\n');` line. This is ~54 lines.

**Functions that remain in `context.ts` (do not touch):**
- `loadCoreMemoryFromStore()` (lines 11-15) — used by other modules that need the formatted self-doc header for non-prompt purposes
- `estimateTokens()` (line 72) — used by `compaction.ts`, `chunking.ts`, `ingest.ts`, `retrieve.ts`
- `repairConversation()` (lines 91-139) — used by `agent.ts`
- `trimOldToolResults()` (lines 149-207) — used by `agent.ts`
- `shouldTruncate()` (lines 209-223) — exported via barrel

The `Store` import (line 4) is still needed by `loadCoreMemoryFromStore`. The `Message`, `ContentBlock`, `ToolUseBlock`, `ToolResultBlock` imports (line 3) are still needed by `repairConversation` and `trimOldToolResults`.

**Verification:**

Run: `bun run build`
Expected: Build succeeds with no type errors

**Commit:** Do not commit yet — commit with Task 2.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify no remaining references to removed symbols

**Verifies:** prompt-templates.AC3.4, prompt-templates.AC5.3

**Files:**
- No file changes expected — this is a verification task

**Implementation:**

Run these verification commands to confirm the cleanup is complete:

```bash
# No references to personaPath in production code
grep -r "personaPath" src/ --include="*.ts" --include="*.tsx" -l

# No references to systemPromptProvider in production code
grep -r "systemPromptProvider" src/ --include="*.ts" --include="*.tsx" -l

# No Bun.file() calls for persona content
grep -r "persona" src/ --include="*.ts" --include="*.tsx" -l

# No persona.md file exists
ls persona.md

# No imports of buildSystemPrompt from context.ts
grep -r "buildSystemPrompt.*context" src/ --include="*.ts" --include="*.tsx" -l

# No PERSONA_PATH references
grep -r "PERSONA_PATH" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: All grep commands return no results. `ls persona.md` returns "No such file or directory".

If any references are found, fix them before proceeding.

**Final verification:**

Run: `bun run build`
Expected: Build succeeds

Run: `bun test`
Expected: All tests pass

Run: `bun start`
Expected: Agent launches correctly

**Commit:** `refactor(prompt): remove old buildSystemPrompt from context.ts, verify clean state`

This commit covers Tasks 1-2 as they form one atomic cleanup.

<!-- END_TASK_2 -->
