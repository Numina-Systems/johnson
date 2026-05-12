# TUI Neo-Blessed Migration — Phase 5: Tools, Secrets & Schedules Views

**Goal:** Build three management views covering tool/skill review with grant management, secret vault management, and scheduled task display.

**Architecture:** Each view is a factory function returning `ScreenView`. Tools view uses three sections cycled with Left/Right arrows (not Tab, which is reserved for global tab switching). Secrets view has multiple modes (list, add name, add value, edit skills). Schedules view is read-only with a toggle. All use `SelectableList` from Phase 2.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 5 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC1: All 7 screens render with equivalent functionality
- **tui-neo-blessed.AC1.3 Success:** Tools screen displays three sections (Custom, Built-in, Skills) with code viewing and secret assignment
- **tui-neo-blessed.AC1.4 Success:** Secrets screen lists secret names, supports add/delete, and assigns secrets to skills
- **tui-neo-blessed.AC1.5 Success:** Schedules screen lists tasks with cron expression, run count, and enabled toggle

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create tools view

**Verifies:** tui-neo-blessed.AC1.3

**Files:**
- Create: `src/tui/views/tools.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store, GrantRow } from '../../store/store.ts';
import type { CustomToolManager, CustomTool } from '../../tools/custom-tool-manager.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { highlightCode } from '../syntax.ts';
import { parseDescription } from '../util.ts';
```

Type for factory options:

```typescript
type ToolsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly customTools?: CustomToolManager;
  readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
};
```

The `createToolsView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **Section header:** `blessed.box` at `top: 0, height: 1` inside container showing current section name and Left/Right navigation hint. E.g., `◀ Custom Tools (1/3) ▶`

3. **Three sections:** `'custom' | 'builtin' | 'skills'` — tracked by a `currentSection` index.
   - `Left arrow` cycles to previous section, `Right arrow` cycles to next (wrapping)
   - Only the active section's list is visible

4. **SelectableList** for each section — three lists, only one shown at a time:

   **Custom Tools section:**
   - Items from `customTools?.listTools() ?? []`
   - Format each: `{status_icon} {name} — {description}`
   - Status icons: approved `✓` (green), not approved `○` (peach)
   - Key actions:
     - `a` — approve: `customTools.approveTool(name)`, refresh
     - `r` — revoke: `customTools.revokeTool(name)`, refresh
     - `v` — view code: open ScrollableViewer overlay with `highlightCode(tool.code)`
     - `s` — assign secrets: open checkbox sub-mode

   **Built-in Tools section:**
   - Items from `builtinTools ?? []`
   - Format each: `{name} — {description}`
   - Read-only, no key actions

   **Skills section:**
   - Load via `store.docList(500)`, filter `rkey.startsWith('skill:')`
   - For each skill doc, get grant via `store.getGrant(doc.rkey)`
   - Format each: `{grant_icon} {skill_name} — {description}`
   - Grant icons: `'granted'` → `✓` (green), `'pending'` → `○` (peach), `'revoked'` → `✗` (red), no grant → `○`
   - Parse description from skill code using `parseDescription(doc.content)`
   - Key actions:
     - `g` — grant: `store.updateGrantStatus(rkey, 'granted')`, refresh
     - `r` — revoke: `store.updateGrantStatus(rkey, 'revoked')`, refresh
     - `v` — view code: open ScrollableViewer overlay with `highlightCode(doc.content, 'typescript')`
     - `s` — assign secrets: open checkbox sub-mode
     - `d` — delete skill: `store.docDelete(rkey)`, `store.deleteGrant(rkey)`, refresh

5. **Code viewer overlay:** A `ScrollableViewer` that fills the container, shown on top of the list. Escape closes it and returns to the list. Supports Page Up/Down and g/G scrolling.

6. **Secret assignment sub-mode:** A `blessed.list` with checkboxes showing all available secrets from `secrets?.listKeys() ?? []`. Pre-select secrets currently assigned to the item. Space toggles selection. Escape saves and returns to list:
   - For skills: `store.updateGrantSecrets(rkey, selectedSecrets)`
   - For custom tools: `customTools.updateSecrets(name, selectedSecrets)`

7. **Status bar** showing key hints based on current section and mode:
   - List mode: `◀▶:section  v:view  s:secrets  g:grant  r:revoke  Esc:back`
   - Code viewer: `PgUp/PgDn:scroll  g/G:top/bottom  Esc:close`
   - Secret assignment: `Space:toggle  Esc:save & close`

8. **`isCapturingInput`:** `true` when in code viewer or secret assignment sub-mode, `false` otherwise.

9. **Return ScreenView** with standard show/hide/focus/destroy contract.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.3: Three sections exist; section cycling with Left/Right wraps correctly; code viewer shows skill content; secret assignment updates the correct store/manager methods

Test with mock Store, SecretManager, and CustomToolManager using partial mock pattern. Verify:
- Section cycling logic (Left at index 0 wraps to 2, Right at 2 wraps to 0)
- Grant icon formatting for each status
- `parseDescription()` extracts skill descriptions correctly (already tested in util, but verify integration)
- Code viewer is shown/hidden on v/Escape
- Secret assignment calls correct update methods

Test file: `src/tui/views/tools.test.ts`

**Verification:**

Run: `bun test src/tui/views/tools.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add tools view with section cycling, code viewer, and secret assignment`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create secrets view

**Verifies:** tui-neo-blessed.AC1.4

**Files:**
- Create: `src/tui/views/secrets.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { CustomToolManager } from '../../tools/custom-tool-manager.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
```

Type for factory options:

```typescript
type SecretsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly secrets?: SecretManager;
  readonly store: Store;
  readonly customTools?: CustomToolManager;
};
```

The `createSecretsView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **SelectableList** showing secret names. Never display values — only names.
   - Format each: `{name}  used by: {skill1, tool2, ...}` or just `{name}` if not assigned
   - To find "used by": check `store.listGrants()` for grants with this secret in their secrets array, plus `customTools?.listTools()` for tools with this secret

3. **Five modes** tracked by internal state:
   - `'list'` — default, browsing secrets list
   - `'add_name'` — inline text input for secret name
   - `'add_value'` — inline text input for secret value (input masked/hidden)
   - `'confirm_delete'` — confirmation dialog
   - `'edit_skills'` — checkbox list for assigning secret to skills/tools

4. **Key actions in list mode:**
   - `a` — switch to `'add_name'` mode: show a `blessed.textbox` (single-line input) for entering the secret name
   - `d` — switch to `'confirm_delete'` mode: show confirmation "Delete secret '{name}'? (y/n)"
   - `s` — switch to `'edit_skills'` mode: show checkbox list of all skills + custom tools, pre-selecting those that use this secret

5. **Add flow:**
   - `'add_name'` mode: `blessed.textbox` for name input. Enter → validate name non-empty → switch to `'add_value'` mode. Escape → cancel, return to list.
   - `'add_value'` mode: `blessed.textbox` for value input (could use `censor: true` if blessed supports it, otherwise plain). Enter → call `await secrets.set(name, value)` → refresh list → return to `'list'` mode. Escape → cancel.

6. **Delete flow:**
   - Show confirmation box. `y` → `await secrets.remove(selectedKey)` → refresh → list mode. `n` or Escape → list mode.

7. **Edit skills flow:**
   - Show all assignable items: skill rkeys from `store.listGrants()` + custom tool names from `customTools?.listTools()`
   - Pre-check items that currently have this secret assigned
   - Space toggles selection
   - Escape saves: for each item, update the secrets list via `store.updateGrantSecrets(rkey, secrets)` or `customTools.updateSecrets(name, secrets)`. Return to list mode.

8. **Status bar** shows mode-specific hints:
   - List: `a:add  d:delete  s:assign tools  Esc:back`
   - Add name: `Enter:confirm  Esc:cancel`
   - Add value: `Enter:save  Esc:cancel`
   - Confirm delete: `y:confirm  n:cancel`
   - Edit skills: `Space:toggle  Esc:save & close`

9. **`isCapturingInput`:** `true` in all modes except `'list'` (add/edit modes need text input).

10. **Return ScreenView** with standard contract.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.4: List shows secret names (never values); add flow calls `secrets.set()`; delete flow calls `secrets.remove()`; assign flow updates grant/tool secrets

Test with mock SecretManager, Store, CustomToolManager. Verify:
- Mode transitions: list → add_name → add_value → list
- Delete confirmation calls remove on 'y', cancels on 'n'
- Skill assignment updates correct store methods

Test file: `src/tui/views/secrets.test.ts`

**Verification:**

Run: `bun test src/tui/views/secrets.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add secrets view with add, delete, and skill assignment`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Create schedules view

**Verifies:** tui-neo-blessed.AC1.5

**Files:**
- Create: `src/tui/views/schedules.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { TaskStore, TaskState } from '../../scheduler/types.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { formatDate } from '../util.ts';
```

Type for factory options:

```typescript
type SchedulesViewOptions = {
  readonly screen: Widgets.Screen;
  readonly scheduler?: TaskStore;
};
```

The `createSchedulesView(options)` factory should:

1. **Container:** `blessed.box` at `top: 1, left: 0, width: '100%', bottom: 0, hidden: true`.

2. **SelectableList** showing scheduled tasks from `scheduler?.list() ?? []`.

3. **Format each task** as a tagged string (extract as a pure function `formatTaskLine(task: TaskState): string`):
   - Enabled icon: `●` (green) if enabled, `○` (overlay0) if disabled
   - Task name
   - Schedule expression (cron string)
   - Run count
   - Last run status: `{date} OK/FAIL ({duration}s)` or `Never run`
   - Example: `{green-fg}●{/} daily-summary  0 9 * * *  (3 runs)  2h ago OK (1.2s)`

4. **Key actions:**
   - `e` — toggle enabled: `scheduler.setEnabled(task.id, !task.enabled)`, refresh
   - Arrow keys navigate (handled by SelectableList)

5. **Status bar:** `e:toggle enabled  Esc:back`

6. **`isCapturingInput`:** Always `false` — no text input in this view.

7. **Return ScreenView** with standard contract.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC1.5: List shows tasks with cron expression, run count, enabled state; `e` toggles enabled and calls `scheduler.setEnabled()`

Extract `formatTaskLine()` as pure function and test directly:
- Enabled task shows green `●`
- Disabled task shows dim `○`
- Task with last run shows formatted date, OK/FAIL, duration
- Task without last run shows "Never run"

Test file: `src/tui/views/schedules.test.ts`

**Verification:**

Run: `bun test src/tui/views/schedules.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add schedules view with task listing and enabled toggle`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire all three views into index.ts

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

1. Import `createToolsView`, `createSecretsView`, `createSchedulesView` from `./views/`

2. Create each view in `startTUI`:
   ```typescript
   const toolsView = createToolsView({
     screen,
     store: deps.store,
     secrets: deps.secrets,
     customTools: deps.customTools,
     builtinTools: deps.builtinTools,
   });

   const secretsView = createSecretsView({
     screen,
     secrets: deps.secrets,
     store: deps.store,
     customTools: deps.customTools,
   });

   const schedulesView = createSchedulesView({
     screen,
     scheduler: deps.scheduler,
   });
   ```

3. Replace the `null` entries in the views array:
   - Index 2: `toolsView`
   - Index 3: `secretsView`
   - Index 4: `schedulesView`

4. Update tab switching to properly show/hide these views.

**Step 2: Verify operationally**

Run: `bun start`
Expected: All three new views render with data. Tools view shows sections cycling with Left/Right. Code viewer works. Secrets view shows names, add/delete work. Schedules view shows tasks with toggle.

**Step 3: Verify build and tests**

Run: `bun run build && bun test src/tui/views/`
Expected: Build succeeds, all view tests pass

**Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): wire tools, secrets, and schedules views into neo-blessed entry point"
```
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
