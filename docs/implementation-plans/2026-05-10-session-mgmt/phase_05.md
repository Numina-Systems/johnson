# Session Management Implementation Plan — Phase 5

**Goal:** Add a multi-select Prune Screen to the TUI for interactive session archival and deletion.

**Architecture:** New `PruneScreen.tsx` component following the screen patterns in `SessionsScreen.tsx` (single-select list, j/k navigation, StatusBar) and `ToolsScreen.tsx` (multi-select with `Set<string>`, sub-mode callback). Accessible via `'r'` keybinding from SessionsScreen. Uses `archiver.archiveSession()` for sessions with messages and `store.deleteSession()` for empty sessions.

**Tech Stack:** TypeScript, React 19, Ink, bun:test

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-mgmt.AC5: TUI prune screen allows interactive management
- **session-mgmt.AC5.1 Success:** Displays all sessions with title, message count, relative last-active time, classification badge
- **session-mgmt.AC5.2 Success:** `j`/`k` navigates, `space` toggles selection, `a` selects all empty+stale
- **session-mgmt.AC5.3 Success:** `enter` shows confirmation with counts before executing
- **session-mgmt.AC5.4 Success:** Selected sessions with messages are archived; selected empty sessions are deleted
- **session-mgmt.AC5.5 Success:** `escape` returns to Sessions screen without changes
- **session-mgmt.AC5.6 Success:** Screen accessible via `r` keybinding from Sessions screen

---

<!-- START_TASK_1 -->
### Task 1: Add `'prune'` to Screen type

**Files:**
- Modify: `src/tui/types.ts:10`

**Implementation:**

Change the Screen type to include `'prune'`:

```typescript
export type Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt' | 'prune';
```

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add prune screen type`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/tui/screens/PruneScreen.tsx`

**Verifies:** session-mgmt.AC5.1, session-mgmt.AC5.2, session-mgmt.AC5.3, session-mgmt.AC5.4, session-mgmt.AC5.5

**Files:**
- Create: `src/tui/screens/PruneScreen.tsx`

**Implementation:**

Pattern comment: `// pattern: UI Shell — multi-select session prune screen`

**Props type:**

```typescript
type PruneScreenProps = {
  readonly store: Store;
  readonly subAgent?: SubAgentLLM;
  readonly embedding?: EmbeddingProvider;
  readonly onBack: () => void;
  readonly onSubModeChange?: (active: boolean) => void;
};
```

**State:**

- `sessions: Array<SessionWithCounts & { classification: SessionClassification }>` — loaded from store, each annotated with classification
- `selectedIdx: number` — cursor position (j/k navigation)
- `selected: Set<string>` — multi-select tracked by session ID
- `mode: 'select' | 'confirm' | 'executing'` — screen sub-modes
- `result: PruneResult | null` — result after execution (for summary display)

**Data loading:**

In `useEffect`, call `store.listSessionsWithCounts()`, then for each session call `classifySession(s.messageCount, s.updatedAt, new Date())` from `src/sessions/archive.ts`. Store the enriched list in state.

**Sub-mode notification:**

Use `onSubModeChange` callback like ToolsScreen does — notify parent when entering `confirm` or `executing` mode to disable global keybindings:

```typescript
useEffect(() => {
  onSubModeChange?.(mode !== 'select');
  return () => onSubModeChange?.(false);
}, [mode, onSubModeChange]);
```

**Keybindings (select mode):**

- `j` / `k` / `downArrow` / `upArrow` — move cursor
- `space` — toggle selection of session at cursor
- `a` — select all sessions classified as `"delete"` or `"archive"` (empty + stale)
- `enter` — transition to `'confirm'` mode (show counts of what will be archived vs deleted)
- `escape` — call `onBack()` (AC5.5)

**Keybindings (confirm mode):**

- `y` or `enter` — execute: transition to `'executing'`, process selected sessions
- `n` or `escape` — back to `'select'` mode

**Execution logic (AC5.4):**

For each selected session:
- If `messageCount === 0`: call `store.deleteSession(id)` (delete empty sessions)
- If `messageCount > 0`: call `archiveSession(id, store)` from the archiver — no `subAgent` or `embedding` passed (see note below)

Collect results into a `PruneResult`-shaped object. After completion, show summary and return to select mode (or back to SessionsScreen).

**Limitation:** TUI-initiated archival does not generate LLM summaries or embeddings because `TuiDependencies` does not expose `SubAgentLLM` or `EmbeddingProvider`. This is acceptable per AC3.4 and AC3.7 — archival succeeds without them, and the archive document is still searchable via FTS. Agent-initiated archival via sandbox tools (Phase 4) has access to these dependencies and will produce summaries + embeddings.

**Rendering (select mode) — AC5.1:**

Each session row shows:
- Checkbox: `[✓]` if selected, `[ ]` if not
- Cursor: `▸` if at selectedIdx
- Title: `session.title ?? 'Untitled session'`
- Message count: `(N msgs)`
- Last active: `formatDate(session.updatedAt)` — using existing `formatDate` from `src/tui/util.ts`
- Classification badge: `[delete]`, `[archive]`, or `[active]` in theme-appropriate colours (e.g., `theme.danger` for delete, `theme.warning` for archive, `theme.success` for active)

**Rendering (confirm mode) — AC5.3:**

Show counts: "Archive N sessions, delete M sessions. Proceed? (y/n)"

**StatusBar:**

```typescript
<StatusBar
  keys={[
    { key: 'j/k', label: 'move' },
    { key: '␣', label: 'toggle' },
    { key: 'a', label: 'select stale' },
    { key: '⏎', label: 'execute' },
    { key: 'esc', label: 'back' },
  ]}
/>
```

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add PruneScreen component`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire PruneScreen into App.tsx and add `r` keybinding

**Verifies:** session-mgmt.AC5.6

**Files:**
- Modify: `src/tui/App.tsx:10` (add import)
- Modify: `src/tui/App.tsx:73-87` (add `'r'` to global nav keybindings)
- Modify: `src/tui/App.tsx:89-156` (add `case 'prune':` to screen switch)

**Implementation:**

Add import after existing screen imports (around line 10):

```typescript
import PruneScreen from './screens/PruneScreen.tsx';
```

Add `'r'` keybinding in the global navigation block (inside `useInput` at line 74-87). Add after the `if (input === 'p')` line:

```typescript
if (input === 'r') push('prune');
```

Add case to the switch statement (before the closing brace, after `case 'prompt':`):

```typescript
case 'prune':
  return (
    <PruneScreen
      store={deps.store}
      onBack={pop}
      onSubModeChange={setSubModeActive}
    />
  );
```

Note: `subAgent` and `embedding` are not directly available in `TuiDependencies`. The design says the TUI prune screen calls the archiver directly. Since `TuiDependencies` doesn't have `subAgent` or `embedding`, archival from the TUI will proceed without summary generation or embedding (which is acceptable per AC3.4 and AC3.7 — archival succeeds without them). If the user later wants TUI archival to include summaries/embeddings, `TuiDependencies` can be extended — but that's out of scope for this phase.

Also add `'r'` keybinding label to SessionsScreen's StatusBar. Modify `src/tui/screens/SessionsScreen.tsx:120-132` to add:

```typescript
{ key: 'r', label: 'prune' },
```

Add this to the `keys` array in the StatusBar, after the `'d'` key entry.

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): wire PruneScreen and r keybinding`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Manual TUI verification

**Verifies:** session-mgmt.AC5.1, session-mgmt.AC5.2, session-mgmt.AC5.3, session-mgmt.AC5.4, session-mgmt.AC5.5, session-mgmt.AC5.6

**Files:** None (verification only)

**Verification:**

This is a TUI screen — verify it works by running the application. Testing React/Ink components requires `ink-testing-library` which is not in the project's dependencies and adding it is out of scope.

Run: `bun start`

Manual checks:
1. From Sessions screen, press `r` — should navigate to Prune Screen (AC5.6)
2. Screen should show all sessions with title, message count, last active time, and classification badge (AC5.1)
3. Press `j`/`k` to navigate, `space` to toggle selection, `a` to select all stale (AC5.2)
4. Press `enter` — should show confirmation with counts (AC5.3)
5. Confirm — sessions with messages should be archived, empty sessions should be deleted (AC5.4)
6. Press `escape` from select mode — should return to Sessions screen (AC5.5)

If the app cannot be started (missing config, API keys, etc.), verify via `bunx tsc --noEmit` that the code compiles and document the manual test plan for the user.

**Commit:** No commit — verification only
<!-- END_TASK_4 -->
