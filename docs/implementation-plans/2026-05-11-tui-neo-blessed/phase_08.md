# TUI Neo-Blessed Migration — Phase 8: Ink Removal & Cleanup

**Goal:** Remove all Ink/React dependencies, delete old screen files, verify clean build with no dead code from the Ink implementation.

**Architecture:** This is a cleanup phase. All neo-blessed views are complete (Phases 1-7). Remove the old Ink-based files and dependencies. Verify `startTUI(deps: TuiDependencies)` contract is preserved — `src/index.ts` should not need changes since the contract was maintained throughout.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 8 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC10: Same external contract
- **tui-neo-blessed.AC10.1 Success:** `startTUI(deps: TuiDependencies)` remains the only export from `src/tui/`; `src/index.ts` requires no changes beyond the import

---

<!-- START_TASK_1 -->
### Task 1: Remove Ink/React dependencies from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove dependencies**

```bash
bun remove ink ink-spinner ink-text-input react @types/react react-devtools-core
```

These are the Ink/React packages confirmed in `package.json`:
- `ink` (line 20)
- `ink-spinner` (line 21)
- `ink-text-input` (line 22)
- `react` (line 23)
- `@types/react` (line 15)
- `react-devtools-core` (line 24)

**Step 2: Verify install**

Run: `bun install`
Expected: Installs without errors. No Ink/React packages in `node_modules`.

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: remove ink, react, and related dependencies"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Delete old Ink-based screen files

**Files:**
- Delete: `src/tui/screens/ChatScreen.tsx`
- Delete: `src/tui/screens/PruneScreen.tsx`
- Delete: `src/tui/screens/SchedulesScreen.tsx`
- Delete: `src/tui/screens/SecretsScreen.tsx`
- Delete: `src/tui/screens/SessionsScreen.tsx`
- Delete: `src/tui/screens/SystemPromptScreen.tsx`
- Delete: `src/tui/screens/ToolsScreen.tsx`
- Delete: `src/tui/screens/` directory itself (should be empty after above)
- Delete: `src/tui/App.tsx`
- Delete: `src/tui/ScreenLayout.tsx`

Check if `src/tui/StatusBar.tsx` exists — if so, delete it (replaced by `widgets/status-bar.ts`).

**Step 1: Delete files**

```bash
rm -rf src/tui/screens/
rm -f src/tui/App.tsx
rm -f src/tui/ScreenLayout.tsx
rm -f src/tui/StatusBar.tsx
```

**Step 2: Verify no remaining imports**

Search the codebase for any remaining references to deleted files:

```bash
grep -r "App.tsx\|ScreenLayout\|StatusBar.tsx\|screens/" src/tui/ --include="*.ts" --include="*.tsx"
```

Expected: No matches. If any imports reference deleted files, update them.

**Step 3: Check for any other .tsx files in src/tui/**

```bash
find src/tui/ -name "*.tsx"
```

Expected: No `.tsx` files remain. All neo-blessed code uses `.ts` extension.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old Ink-based screen files and React components"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Remove React JSX configuration if safe

**Files:**
- Possibly modify: `tsconfig.json`

**Step 1: Check if React JSX is used elsewhere**

```bash
grep -r "jsx\|tsx" src/ --include="*.ts" --include="*.tsx" -l
```

If no `.tsx` files remain in `src/` at all, the `"jsx": "react-jsx"` in `tsconfig.json` can be removed. However, if other parts of the codebase use JSX (unlikely but check), leave it.

**Step 2: If safe to remove**

Remove `"jsx": "react-jsx"` and `"jsxImportSource"` (if present) from `tsconfig.json`.

**Step 3: If not safe to remove**

Leave `tsconfig.json` unchanged. JSX config doesn't cause issues for non-JSX files.

**Step 4: Commit only if changes were made**

```bash
git add tsconfig.json
git commit -m "chore: remove React JSX configuration from tsconfig"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify src/index.ts contract and clean build

**Verifies:** tui-neo-blessed.AC10.1

**Step 1: Verify import in src/index.ts**

Check that `src/index.ts` still imports `startTUI` from `./tui/index.ts`:
```bash
grep "startTUI" src/index.ts
```

Expected: `import { startTUI } from './tui/index.ts';` — unchanged from the original. If the import path or function name changed, that's a contract violation — fix it.

**Step 2: Verify startTUI export**

Check that `src/tui/index.ts` exports `startTUI` and `TuiDependencies`:
```bash
grep "export" src/tui/index.ts | head -5
```

Expected: Named exports for `startTUI` function and `TuiDependencies` type.

**Step 3: Full build**

Run: `bun run build`
Expected: Build succeeds with zero errors. No Ink/React imports remain.

**Step 4: Full test suite**

Run: `bun test`
Expected: All tests pass. The 2 pre-existing failures in `workspace/email/` are unrelated and acceptable.

**Step 5: Audit keybindings for AC5.2 compliance**

Verify that only the justified C-c exception uses Ctrl/Alt modifiers:

```bash
grep -rn "'C-\|'M-" src/tui/ --include="*.ts"
```

Expected: Only `'C-c'` in `index.ts` (the justified deviation). No other Ctrl or Alt bindings should exist.

**Step 6: Verify no dead imports**

Search for any remaining Ink/React references across the entire `src/` directory:

```bash
grep -r "from 'ink'" src/ --include="*.ts" --include="*.tsx"
grep -r "from 'react'" src/ --include="*.ts" --include="*.tsx"
grep -r "from 'ink-" src/ --include="*.ts" --include="*.tsx"
```

Expected: No matches.

**Step 7: Operational verification**

Run: `bun start`
Expected: Neo-blessed TUI launches with all 7 tabs functional. Tab/Shift+Tab navigates. Chat works. All views render correctly.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore(tui): verify clean build — all Ink/React code removed, neo-blessed migration complete"
```
<!-- END_TASK_4 -->
