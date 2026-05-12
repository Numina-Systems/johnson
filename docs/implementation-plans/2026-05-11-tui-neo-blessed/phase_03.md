# TUI Neo-Blessed Migration — Phase 3: Sessions View & Event Bus

**Goal:** Build the first real view — session listing with create/delete/select — and establish the typed event bus pattern that all views use for cross-view communication.

**Architecture:** Sessions view is a factory function returning `ScreenView`. It uses `SelectableList` from Phase 2 to render sessions from `Store.listSessionsWithCounts()`. The event bus is a typed `EventEmitter` instantiated in `index.ts` and passed to views via a shared options type. `index.ts` is updated to replace the Phase 1 placeholder with the real Sessions view.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 3 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC1: All 7 screens render with equivalent functionality
- **tui-neo-blessed.AC1.1 Success:** Sessions screen lists sessions with title, message count, and last activity timestamp

### tui-neo-blessed.AC4: Tab bar navigation
- **tui-neo-blessed.AC4.1 Success:** Tab bar is visible at top of every screen showing all 7 tab labels

### tui-neo-blessed.AC8: Functional Core / Imperative Shell
- **tui-neo-blessed.AC8.1 Success:** Theme, types, syntax highlighting, and message formatting modules are pure functions with no side effects

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create views directory and sessions view

**Verifies:** tui-neo-blessed.AC1.1, tui-neo-blessed.AC8.1

**Files:**
- Create: `src/tui/views/sessions.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

Create a factory function that builds the Sessions view using `SelectableList` from Phase 2.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SessionWithCounts } from '../../sessions/types.ts';
import type { ScreenView, TuiEvents } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { formatDate } from '../util.ts';
```

Type for the factory options:

```typescript
type SessionsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
  readonly bus: EventEmitter;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
};
```

The `createSessionsView(options)` factory should:

1. Create a container `blessed.box` with `top: 1, left: 0, width: '100%', bottom: 0, hidden: false`. This is the view's root element returned as `container` in the `ScreenView`.

2. Create a header `blessed.box` inside the container at `top: 0, height: 1` showing the model name or "Sessions" title.

3. Create a `SelectableList` inside the container for the session list, positioned below the header and above the status bar.

4. Create a `StatusBar` inside the container showing keybinding hints: `n:new  d:delete  Enter:open  q:quit`.

5. Internal state:
   - `sessions: Array<SessionWithCounts>` — loaded from store
   - `isCapturingInput: boolean` — false normally, true during confirmation dialogs

6. `refresh()` function:
   - Calls `store.listSessionsWithCounts(50)`
   - Formats each session as a tagged string for the list: `{bold}Title{/bold}  (N msgs)  timestamp`
   - If title is null, display "Untitled session"
   - Use `formatDate()` from `util.ts` for relative timestamps
   - Calls `list.setItems(formatted)`

7. Key bindings (on the list element):
   - `'n'`: Create new session — generate UUID via `crypto.randomUUID()`, call `store.createSession(id)`, call `options.onNewSession()` or emit `session:changed`, then `refresh()`
   - `'d'`: Delete with confirmation — show a confirmation `blessed.question` dialog or a simple inline prompt. On confirm, call `store.deleteSession(sessions[selectedIndex].id)`, then `refresh()`. Set `isCapturingInput = true` during confirmation, reset to false after.
   - `'enter'` (via SelectableList's select event): Get the selected session ID, call `options.onSelectSession(sessionId)`, emit `session:selected` on the bus

8. Listen on bus for `'session:changed'` to auto-refresh the list.

9. Return `ScreenView`:
   ```typescript
   return {
     name: 'Sessions',
     container,
     get isCapturingInput() { return capturing; },
     show() { container.show(); refresh(); screen.render(); },
     hide() { container.hide(); screen.render(); },
     focus() { list.focus(); },
     destroy() { container.destroy(); },
   };
   ```

**Formatting sessions as pure function (Functional Core):**

Extract a pure function `formatSessionLine(session: SessionWithCounts): string` that builds the blessed tagged string. This can live in the same file or in a separate `src/tui/views/format.ts` if reused. This satisfies AC8.1 — the formatting logic is a pure function.

```typescript
function formatSessionLine(session: SessionWithCounts): string {
  const title = session.title ?? 'Untitled session';
  const count = `(${session.messageCount} msgs)`;
  const date = session.lastMessageAt ? formatDate(session.lastMessageAt) : formatDate(session.createdAt);
  return `{bold}${title}{/bold}  ${count}  {${palette.overlay0}-fg}${date}{/}`;
}
```

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.1: `formatSessionLine()` produces correct output with title, message count, and timestamp. Test with sessions that have titles and null titles.
- tui-neo-blessed.AC8.1: `formatSessionLine()` is a pure function (no side effects, deterministic output for same input)

For the view factory itself, test with a mock Store (using the project's partial mock pattern):
- Calling `refresh()` after `show()` populates the list from store
- Select event calls `onSelectSession` with correct session ID
- `n` key triggers session creation
- `d` key triggers deletion (with confirmation flow)

Test file: `src/tui/views/sessions.test.ts`

**Verification:**

Run: `bun test src/tui/views/sessions.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add sessions view with list, create, delete, and select`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire sessions view into index.ts and update event bus

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

Update `index.ts` to:

1. Replace the Phase 1 placeholder content box with the real Sessions view.

2. Instantiate the typed event bus (already stubbed in Phase 1, now make it real):
   ```typescript
   import { EventEmitter } from 'events';
   const bus = new EventEmitter();
   ```

3. Create the Sessions view:
   ```typescript
   const sessionsView = createSessionsView({
     screen,
     store: deps.store,
     bus,
     onSelectSession(sessionId) {
       // For now, just emit the event — Chat view will handle it in Phase 4
       bus.emit('session:selected', { sessionId });
       // Switch to Chat tab (index 1)
       switchTab(1);
     },
     onNewSession() {
       bus.emit('session:changed');
     },
   });
   ```

4. Set up the views array. For now, only Sessions is real — other tabs still show placeholder content. Structure the views array so each index corresponds to a tab:
   ```typescript
   const views: Array<ScreenView | null> = [
     sessionsView,  // 0: Sessions
     null,          // 1: Chat (Phase 4)
     null,          // 2: Tools (Phase 5)
     null,          // 3: Secrets (Phase 5)
     null,          // 4: Schedules (Phase 5)
     null,          // 5: Prompt (Phase 6)
     null,          // 6: Prune (Phase 6)
   ];
   ```

5. Update the tab switching logic (`switchTab` function) to call `hide()` on current view and `show()` on new view. For null views, show a placeholder box saying "Coming soon: [TabName]".

6. `q` quit key should check `views[activeTab]?.isCapturingInput` before quitting.

7. On startup, call `sessionsView.show()` and `sessionsView.focus()`.

**Step 2: Verify operationally**

Run: `bun start`
Expected: Sessions view renders with session list from the store. Arrow keys navigate. Enter selects (switches to Chat tab placeholder). `n` creates a new session. `d` deletes with confirmation. Tab/Shift+Tab still cycles tabs. Tab bar shows Sessions as active.

**Step 3: Verify build**

Run: `bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): wire sessions view and event bus into neo-blessed entry point"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
