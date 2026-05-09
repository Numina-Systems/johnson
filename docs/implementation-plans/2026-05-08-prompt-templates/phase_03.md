# Prompt Templates Implementation Plan — Phase 3

**Goal:** Migrate domain knowledge (identity, obsidian vault, scheduling, skill conventions, file ingestion guidance) to the self document via a one-time seeding step, then delete persona.md.

**Architecture:** A seeding function in `src/index.ts` checks whether the `self` document is empty or missing domain knowledge content, and appends it if needed. The seed content is defined as a constant in the seeding module. After seeding is wired up, `persona.md` is deleted.

**Tech Stack:** TypeScript, bun:test

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-05-08

---

## Acceptance Criteria Coverage

This phase implements and tests:

### prompt-templates.AC7: Self doc seeding
- **prompt-templates.AC7.1 Success:** On first run with empty self doc, identity + domain knowledge content is seeded
- **prompt-templates.AC7.2 Success:** On run with existing self doc content, seeding appends without clobbering
- **prompt-templates.AC7.3 Edge:** On run where self doc already contains seeded content, no duplication occurs

### prompt-templates.AC1: persona.md content decomposed into template constants
- **prompt-templates.AC1.3 Success:** `persona.md` is deleted from the repository

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create self-doc seeding function

**Verifies:** prompt-templates.AC7.1, prompt-templates.AC7.2, prompt-templates.AC7.3

**Files:**
- Create: `src/agent/seed-self-doc.ts`

**Implementation:**

Create `src/agent/seed-self-doc.ts` annotated with `// pattern: Imperative Shell — one-time self-doc seeding`.

Define a module-private constant `SEED_CONTENT` containing the domain knowledge to seed. This content comes from `persona.md` and is concatenated into a single string with clear section headings:

1. **Identity paragraph** (persona.md lines 1-3): The "You are a general-purpose AI agent..." and "Your name is Johnson..." paragraphs.

2. **Obsidian vault workflow** (persona.md lines 170-186): The entire "Obsidian Vault — Giulia's Notes" section including workflow steps and critical rules.

3. **Skill conventions** (persona.md lines 187-200): The "Skills" section about how to save, list, read, run skills.

4. **Scheduled tasks conventions** (persona.md lines 201-250): The "Scheduled Tasks" section including trigger guards and examples.

5. **File ingestion guidance** (persona.md lines 130-159): The domain knowledge portion about intent inference heuristics ("If Giulia doesn't specify an intent, infer from context..."), security/limits note, and the pandoc conversion guidance for non-text files. Do NOT include the tool signature/parameters (lines 130-146 parameter list) — only the inference guidance (lines 141-146) and non-text files section (lines 148-159).

Define a module-private constant `SEED_MARKER` — a short unique string that identifies seeded content, e.g. `'<!-- seeded-from-persona -->'`. This marker is checked to prevent duplicate seeding.

Export a function:

```typescript
import type { Store } from '../store/store.ts';

export function seedSelfDoc(store: Store): void {
  const existing = store.docGet('self');
  const content = existing?.content?.trim() ?? '';

  // Already seeded — skip
  if (content.includes(SEED_MARKER)) return;

  const seeded = content
    ? `${content}\n\n${SEED_MARKER}\n${SEED_CONTENT}`
    : `${SEED_MARKER}\n${SEED_CONTENT}`;

  store.docUpsert('self', seeded);
}
```

Key behaviors:
- If self doc is empty or missing: write `SEED_MARKER + SEED_CONTENT`
- If self doc has existing content but no marker: append `\n\n` separator + `SEED_MARKER + SEED_CONTENT` (preserves existing content)
- If self doc already contains the marker: do nothing (no duplication)

The marker approach is simple and reliable — the agent can freely edit the seeded content after migration, and the marker prevents re-seeding on subsequent startups.

**Verification:**

Run: `bun run build`
Expected: Build succeeds

**Commit:** Do not commit yet — commit with Task 2.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create tests for self-doc seeding

**Verifies:** prompt-templates.AC7.1, prompt-templates.AC7.2, prompt-templates.AC7.3

**Files:**
- Create: `src/agent/seed-self-doc.test.ts`

**Implementation:**

Create test file annotated with `// pattern: Imperative Shell (test) — tests self-doc seeding with in-memory store`.

Use `bun:test` with `describe`/`test`/`expect` imports. Use in-memory SQLite store (via `createStore(':memory:')` or equivalent factory — check how `src/tools/ingest.test.ts` creates its store at line 57).

**Testing:**

Tests must verify each AC listed above:

- **prompt-templates.AC7.1 (first run, empty self doc):**
  - Create store with no self doc
  - Call `seedSelfDoc(store)`
  - Verify `store.docGet('self')` contains the seed marker
  - Verify content contains identity paragraph text (e.g., "Johnson")
  - Verify content contains obsidian vault section
  - Verify content contains skill conventions section
  - Verify content contains scheduled tasks section
  - Verify content contains file ingestion guidance

- **prompt-templates.AC7.2 (existing content, no clobbering):**
  - Create store, upsert self doc with existing content like "I learned that Giulia prefers markdown"
  - Call `seedSelfDoc(store)`
  - Verify existing content is still present (not overwritten)
  - Verify seeded content is appended after existing content
  - Verify seed marker is present

- **prompt-templates.AC7.3 (already seeded, no duplication):**
  - Create store, seed once
  - Capture content after first seed
  - Call `seedSelfDoc(store)` again
  - Verify content is identical to first seed (no duplication)

Follow project testing patterns: in-memory SQLite store, `describe`/`test` blocks, `expect()` assertions.

**Verification:**

Run: `bun test src/agent/seed-self-doc.test.ts`
Expected: All tests pass

**Commit:** `feat(prompt): add self-doc seeding for domain knowledge migration`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire seeding into `main()` and delete persona.md

**Verifies:** prompt-templates.AC1.3, prompt-templates.AC5.3

**Files:**
- Modify: `src/index.ts:50-51` (after store creation)
- Delete: `persona.md`

**Implementation:**

**Wire seeding in `src/index.ts`:**

After the store is created (line 51: `const store = createStore(...)`) and before the agent is built, add the seeding call:

```typescript
import { seedSelfDoc } from './agent/seed-self-doc.ts';

// After store creation (around line 51):
seedSelfDoc(store);
```

This runs once on every startup, but the marker check makes it a no-op after the first successful seed.

**Delete persona.md:**

Remove `persona.md` from the repository root. After Phase 2's changes, nothing references this file anymore — verify by grepping:

```bash
grep -r "persona" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: no results (all references were removed in Phase 2).

Also check:
- No references in `package.json`
- No references in `tsconfig.json`
- No references in `config.toml.example`

**Verification:**

Run: `bun run build`
Expected: Build succeeds

Run: `bun test`
Expected: All tests pass

Run: `bun start`
Expected: Agent launches. On first run, self doc is seeded with domain knowledge content.

**Commit:** `feat(prompt): wire self-doc seeding, delete persona.md`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
