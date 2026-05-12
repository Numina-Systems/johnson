# TUI Neo-Blessed Migration — Phase 6: SystemPrompt & Prune Views

**Goal:** Build the remaining two views — a read-only system prompt viewer and a multi-select session pruner with classification and archive/delete execution.

**Architecture:** SystemPrompt view uses `ScrollableViewer` to display the prompt text fetched via an async callback. Prune view uses `SelectableList` with checkbox state tracked in a `Set<string>`, classification via `classifySession()` from the sessions module, and execution via `archiveSession()` + `store.deleteSession()`.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 6 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC1: All 7 screens render with equivalent functionality
- **tui-neo-blessed.AC1.6 Success:** SystemPrompt screen displays the current system prompt in a scrollable viewer
- **tui-neo-blessed.AC1.7 Success:** Prune screen shows sessions with checkboxes, classifies selections, and executes archive/delete

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create system-prompt view

**Verifies:** tui-neo-blessed.AC1.6

**Files:**
- Create: `src/tui/views/system-prompt.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { ScreenView } from '../types.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
```

Type for factory options:

```typescript
type SystemPromptViewOptions = {
  readonly screen: Widgets.Screen;
  readonly getSystemPrompt: () => Promise<string>;
};
```

The `getSystemPrompt` callback is constructed in `index.ts` using the same pattern as the current App.tsx — it calls `buildSystemPrompt()` from `src/agent/prompt.ts` with the necessary params gathered from TuiDependencies.

The `createSystemPromptView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **Header:** `blessed.box` at `top: 0, height: 1` showing "System Prompt".

3. **ScrollableViewer** positioned below header and above status bar. Displays the prompt text as plain text (no syntax highlighting needed — it's a text prompt, not code).

4. **Status bar** showing: `PgUp/PgDn:scroll  g/G:top/bottom  Esc:back`

5. **Load on show:** When `show()` is called, invoke `getSystemPrompt()` and set the viewer content with the result. Show a "Loading..." message while the promise is pending.

6. **Nice-to-have (F4 editable mode):** The design marks this as nice-to-have. Skip for initial implementation — can be added later. The view is read-only.

7. **`isCapturingInput`:** Always `false` — this is a read-only viewer.

8. **Return ScreenView** with standard contract.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.6: View calls `getSystemPrompt()` on show and displays the returned text in the scrollable viewer

Test with a mock `getSystemPrompt` that returns a known string. Verify the viewer's content is set.

Test file: `src/tui/views/system-prompt.test.ts`

**Verification:**

Run: `bun test src/tui/views/system-prompt.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add system-prompt view with scrollable prompt display`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create prune view

**Verifies:** tui-neo-blessed.AC1.7

**Files:**
- Create: `src/tui/views/prune.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SessionWithCounts } from '../../sessions/types.ts';
import { classifySession } from '../../sessions/archive.ts';
import type { SessionClassification } from '../../sessions/types.ts';
import { archiveSession } from '../../sessions/archiver.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { formatDate } from '../util.ts';
```

Type for factory options:

```typescript
type PruneViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
};
```

Internal types:

```typescript
type EnrichedSession = SessionWithCounts & {
  readonly classification: SessionClassification;
};

type PruneMode = 'select' | 'confirm' | 'executing';
```

The `createPruneView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **SelectableList** showing sessions with checkboxes and classification labels.

3. **Internal state:**
   - `sessions: Array<EnrichedSession>` — loaded from store with classifications
   - `selected: Set<string>` — set of selected session IDs
   - `mode: PruneMode` — current interaction mode
   - `resultMsg: string | null` — summary after execution

4. **Load sessions** (`refresh()`):
   - Call `store.listSessionsWithCounts(200)`
   - Classify each via `classifySession(s.messageCount, s.updatedAt, new Date())`
   - Store as `EnrichedSession` array
   - Format list items

5. **Format each session** (extract as pure function `formatPruneLine`):
   - Checkbox: `[✓]` if selected, `[ ]` if not
   - Classification colour: delete → red, archive → peach/yellow, active → green
   - Format: `[✓] {red-fg}delete{/} Title (0 msgs) 2d ago`
   - Or: `[ ] {peach-fg}archive{/} Title (5 msgs) 4d ago`
   - Or: `[ ] {green-fg}active{/} Title (2 msgs) 1h ago`

6. **Key actions in `'select'` mode:**
   - `Space` — toggle selection of current session (add/remove from `selected` set), re-render list
   - `a` — select all stale sessions (classification is `'delete'` or `'archive'`), re-render
   - `Enter` — switch to `'confirm'` mode if any sessions selected
   - `Escape` — navigate back (handled by index.ts)

7. **`'confirm'` mode:**
   - Show a confirmation box displaying classification breakdown:
     ```
     Prune N sessions?
       Delete: X (empty, stale)
       Archive: Y (with messages)
     
     [y] Confirm  [n] Cancel
     ```
   - Count deletions (classification `'delete'` OR `messageCount === 0`) vs archives (has messages)
   - `y` or `Enter` — switch to `'executing'` mode, run execution
   - `n` or `Escape` — return to `'select'` mode

8. **`'executing'` mode:**
   - Update status: "Executing..."
   - Iterate selected sessions:
     - If `messageCount === 0`: `store.deleteSession(id)` (direct delete, no archival)
     - If `messageCount > 0`: `await archiveSession(id, store)` (archives then deletes). **Note:** `archiveSession` is called with only `sessionId` and `store` — the optional `subAgent`, `embedding`, and `embeddingModel` params are omitted. This is intentional and matches the current PruneScreen.tsx behaviour. Archives will be created without AI-generated summaries and without embeddings. This is acceptable degradation — summaries are nice-to-have and the archivist subsystem can enrich archives later.
   - Track results: deleted count, archived count
   - On completion: set `resultMsg` = `"✓ Archived X, deleted Y"`, return to `'select'` mode, refresh list
   - On error: show error in status bar, return to `'select'` mode

9. **Status bar** shows mode-specific text:
   - Select: `Space:toggle  a:select stale  Enter:confirm  Esc:back`
   - Confirm: `y:confirm  n:cancel`
   - Executing: `Processing...`
   - After execution: the result summary

10. **`isCapturingInput`:** `true` in `'confirm'` and `'executing'` modes, `false` in `'select'`.

11. **Return ScreenView** with standard contract.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.7: Sessions shown with checkboxes; classifications are correct; archive/delete execution calls correct methods

Test `formatPruneLine()` as a pure function:
- Selected vs unselected shows different checkbox
- Classification determines colour tag

Test with mock Store:
- Checkbox toggling (Space adds/removes from selected set)
- `a` selects all stale sessions (delete + archive classifications)
- Execution: empty sessions call `store.deleteSession()`, sessions with messages call `archiveSession()`
- Result summary shows correct counts

Test file: `src/tui/views/prune.test.ts`

**Verification:**

Run: `bun test src/tui/views/prune.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add prune view with checkbox selection, classification, and archive/delete`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire system-prompt and prune views into index.ts

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

1. Import `createSystemPromptView` and `createPruneView` from `./views/`.

2. Import `buildSystemPrompt` from `../agent/prompt.ts` and construct the `getSystemPrompt` callback in `startTUI`. Follow the same pattern as the current App.tsx:
   ```typescript
   async function getSystemPrompt(): Promise<string> {
     if (!deps.timezone) {
       return 'System prompt unavailable: timezone not provided.';
     }
     const selfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
     const allDocs = deps.store.docList(500);
     const skillNames = allDocs.documents
       .filter((d) => d.rkey.startsWith('skill:'))
       .map((d) => d.rkey);
     const customToolSummaries = deps.customTools?.getApprovedToolSummaries();
     const secretNames = deps.secrets?.listKeys();
     return buildSystemPrompt({
       selfDoc,
       skillNames,
       toolDocs: deps.toolDocs ?? '',
       timezone: deps.timezone,
       customToolSummaries,
       secretNames,
       nativeToolNames: deps.builtinTools?.map(t => t.name),
     });
   }
   ```

3. Create both views:
   ```typescript
   const systemPromptView = createSystemPromptView({ screen, getSystemPrompt });
   const pruneView = createPruneView({ screen, store: deps.store });
   ```

4. Replace the `null` entries in the views array:
   - Index 5: `systemPromptView`
   - Index 6: `pruneView`

5. Now all 7 views should be real — no more placeholder boxes. Remove any placeholder logic.

**Step 2: Verify operationally**

Run: `bun start`
Expected: All 7 tabs work. SystemPrompt shows the current prompt text, scrollable. Prune shows sessions with checkboxes, classification labels, confirm/execute flow works.

**Step 3: Verify build and tests**

Run: `bun run build && bun test src/tui/views/`
Expected: Build succeeds, all view tests pass

**Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): wire system-prompt and prune views — all 7 screens complete"
```
<!-- END_TASK_3 -->
