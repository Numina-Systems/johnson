# TUI Neo-Blessed Migration — Phase 1: Infrastructure & Shared Foundation

**Goal:** Install neo-blessed, create the screen entrypoint, adapt the theme for blessed style objects, define shared types, and build the tab bar widget. Verify blessed renders in Zellij.

**Architecture:** Replace Ink's `render()` call in `src/tui/index.ts` with a `blessed.screen` instance. Preserve the `startTUI(deps: TuiDependencies)` contract exactly. Add `ScreenView` and `TuiEvents` types. Adapt theme from hex strings to blessed style objects. Create tab bar as a `blessed.box` widget.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 1 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase is infrastructure — no acceptance criteria are directly tested. Verification is operational.

**Verifies: None** — this phase establishes the foundation that later phases build on. Verified operationally via `bun run build` succeeding and `bun start` launching a blessed screen with tab bar navigation.

---

<!-- START_TASK_1 -->
### Task 1: Install neo-blessed and @types/blessed

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run:
```bash
bun add neo-blessed
bun add -d @types/blessed
```

**Step 2: Verify installation**

Run: `bun install`
Expected: Installs without errors

**Step 3: Verify types are available**

Create a temporary file to check imports compile:
```bash
echo 'import blessed from "neo-blessed"; const s: blessed.Widgets.Screen = null as any;' > /tmp/neo-blessed-check.ts && echo "Types available"
```

Remove the temp file after verification.

**Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add neo-blessed and @types/blessed dependencies"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Update types.ts with ScreenView and TuiEvents

**Files:**
- Modify: `src/tui/types.ts`

**Step 1: Add new types while preserving existing ones**

Preserve the existing `// pattern: Functional Core` annotation at the top of the file. The existing `TuiDependencies` type must be preserved exactly. The existing `Screen` type (string literal union) and `NavigationActions` type will be replaced by the new `ScreenView` contract and tab-based navigation. Add the following types:

```typescript
import type { Widgets } from 'blessed';

export type ScreenView = {
  readonly name: string;
  readonly container: Widgets.BoxElement;
  readonly isCapturingInput: boolean;
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
};

export type TuiEvents = {
  'message:new': { role: 'user' | 'agent' | 'system'; text: string };
  'message:status': { status: string };
  'session:selected': { sessionId: string };
  'session:changed': void;
  'tab:activity': { tab: string };
};
```

Remove the old `Screen` string literal union type and `NavigationActions` type — they are replaced by `ScreenView` and the tab bar.

Preserve the existing `TuiDependencies` type exactly as-is:
```typescript
export type TuiDependencies = {
  readonly agent: Agent;
  readonly modelName: string;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: CustomToolManager;
  readonly toolDocs?: string;
  readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
  readonly timezone?: string;
};
```

Keep all existing imports needed for `TuiDependencies`.

**Step 2: Verify**

Run: `bunx tsc --noEmit`
Expected: No type errors (existing screens that import `Screen` or `NavigationActions` will break — that's expected and will be resolved in later phases when those screens are rewritten)

Note: Type errors from existing Ink-based screens referencing the removed `Screen` type are expected. The goal is that `types.ts` itself has no errors. If the project-wide type check fails only due to old screen files referencing removed types, that is acceptable at this stage.

**Step 3: Commit**

```bash
git add src/tui/types.ts
git commit -m "feat(tui): add ScreenView and TuiEvents types for neo-blessed migration"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Adapt theme.ts for blessed style objects

**Files:**
- Modify: `src/tui/theme.ts`

**Step 1: Add blessed style object exports**

The existing `palette` object (hex strings) and `theme` object (semantic mappings referencing palette hex values) must be preserved — other code references them. Add a new `blessedStyles` export alongside the existing exports that maps the semantic theme colours to blessed-compatible style objects.

Each style object should have the shape `{ fg: string; bg?: string; bold?: boolean }` matching what blessed `style` properties accept.

```typescript
export type BlessedStyle = {
  readonly fg: string;
  readonly bg?: string;
  readonly bold?: boolean;
};

export const blessedStyles = {
  userMsg: { fg: palette.lavender, bold: true } as BlessedStyle,
  agentMsg: { fg: palette.green, bold: true } as BlessedStyle,
  systemMsg: { fg: palette.yellow } as BlessedStyle,
  accent: { fg: palette.mauve, bold: true } as BlessedStyle,
  heading: { fg: palette.mauve, bold: true } as BlessedStyle,
  selected: { fg: palette.base, bg: palette.mauve } as BlessedStyle,
  error: { fg: palette.red, bold: true } as BlessedStyle,
  warning: { fg: palette.peach } as BlessedStyle,
  success: { fg: palette.green } as BlessedStyle,
  tabActive: { fg: palette.base, bg: palette.mauve, bold: true } as BlessedStyle,
  tabInactive: { fg: palette.overlay0 } as BlessedStyle,
  border: { fg: palette.surface1 } as BlessedStyle,
  text: { fg: palette.text } as BlessedStyle,
  subtext: { fg: palette.subtext0 } as BlessedStyle,
  surface: { bg: palette.base } as BlessedStyle,
  grantOk: { fg: palette.green, bold: true } as BlessedStyle,
  grantPending: { fg: palette.yellow } as BlessedStyle,
  grantRevoked: { fg: palette.red } as BlessedStyle,
  spinner: { fg: palette.pink } as BlessedStyle,
} as const;
```

These mappings mirror the existing `theme` object exactly:
- `userMsg` → `palette.lavender` (matching `theme.userMsg`)
- `systemMsg` → `palette.yellow` (matching `theme.systemMsg`)
- `grantPending` → `palette.yellow` (matching `theme.grantPending`)
- `spinner` → `palette.pink` (matching `theme.spinner`)

Map the semantic names to the same palette colours the existing `theme` object uses. The exact palette field names come from the existing `palette` export — use those hex values. Check the existing `theme` object's mappings and mirror them.

**Step 2: Verify**

Run: `bunx tsc --noEmit`
Expected: No new type errors introduced

**Step 3: Commit**

```bash
git add src/tui/theme.ts
git commit -m "feat(tui): add blessed style objects to theme alongside existing hex palette"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Create tab-bar.ts widget

**Files:**
- Create: `src/tui/tab-bar.ts`

**Step 1: Implement the tab bar**

Create a tab bar factory function that returns a blessed box element and methods to control it. The tab bar is a `blessed.box` pinned at `top: 0, height: 1, width: '100%'`. It renders tab labels horizontally with the active tab highlighted.

Mark the file as `// pattern: Imperative Shell` since it creates blessed widgets and binds events.

The factory function signature:

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from './theme.ts';

type TabBarOptions = {
  readonly screen: Widgets.Screen;
  readonly labels: ReadonlyArray<string>;
  readonly onSwitch: (index: number) => void;
};

type TabBar = {
  readonly element: Widgets.BoxElement;
  setActive(index: number): void;
  setActivity(tabName: string, hasActivity: boolean): void;
  destroy(): void;
};
```

Implementation details:
- Create a `blessed.box` with `top: 0, left: 0, width: '100%', height: 1, tags: true`
- Background should use `palette.mantle` or `palette.crust` (the darkest Catppuccin surface)
- Render tab labels as tagged strings: active tab uses `blessedStyles.tabActive` colours, inactive uses `blessedStyles.tabInactive`
- Separate tabs with ` | ` (pipe with spaces)
- Activity indicator: append `*` to tab label when that tab has pending activity
- `setActive(index)` updates the rendering to highlight the new active tab
- `setActivity(tabName, hasActivity)` toggles the activity indicator for a tab
- Tab/Shift+Tab key bindings are NOT handled here — they're bound at screen level in `index.ts`

The `renderTabs` internal function should build a tagged string like:
```
 {bold}{#c6a0f6-fg}{#24273a-bg} Sessions {/} | {#6e738d-fg} Chat {/} | {#6e738d-fg} Tools* {/} | ...
```

**Step 2: Verify**

Run: `bunx tsc --noEmit`
Expected: No type errors from this file (other files may still have errors from Task 2)

**Step 3: Commit**

```bash
git add src/tui/tab-bar.ts
git commit -m "feat(tui): add tab bar widget for neo-blessed navigation"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Rewrite index.ts entry point

**Files:**
- Modify: `src/tui/index.ts`

**Step 1: Replace Ink with blessed screen setup**

Rewrite `src/tui/index.ts` to create a `blessed.screen` instance instead of calling Ink's `render()`. The external contract must remain: `startTUI(deps: TuiDependencies): void` is the only export alongside the `TuiDependencies` type re-export.

Mark the file as `// pattern: Imperative Shell`.

Implementation:

```typescript
import blessed from 'neo-blessed';
import { EventEmitter } from 'events';
import type { TuiDependencies, TuiEvents } from './types.ts';
import { createTabBar } from './tab-bar.ts';
import { palette } from './theme.ts';
```

The `startTUI` function should:

1. Create a `blessed.screen` with:
   - `smartCSR: true`
   - `title: 'constellation'`
   - `mouse: true` (enable mouse events)
   - `style: { bg: palette.base }` (Catppuccin Macchiato base background)

2. Create a typed `EventEmitter` for `TuiEvents` — a standard Node `EventEmitter` cast to a typed interface. Create a simple typed wrapper:
   ```typescript
   const bus = new EventEmitter() as EventEmitter & {
     emit<K extends keyof TuiEvents>(event: K, data: TuiEvents[K]): boolean;
     on<K extends keyof TuiEvents>(event: K, listener: (data: TuiEvents[K]) => void): EventEmitter;
   };
   ```

3. Define the tab labels array: `['Sessions', 'Chat', 'Tools', 'Secrets', 'Schedules', 'Prompt', 'Prune']`

4. Create the tab bar via `createTabBar({ screen, labels, onSwitch })` where `onSwitch` toggles view visibility.

5. For now (Phase 1), create a placeholder content box below the tab bar that displays "Screen: [TabName]" to verify tab switching works. This placeholder will be replaced by actual views in Phases 3-7.

6. Bind screen-level keys:
   - `'tab'` → cycle to next tab (wrapping)
   - `'S-tab'` → cycle to previous tab (wrapping)
   - `'q'` → call `screen.destroy()` and `process.exit(0)` (but only when active view's `isCapturingInput` is false — for now, always allow since placeholder views don't capture input)
   - `'escape'` → switch to Sessions tab (index 0)
   - `'C-c'` → always quit (unconditional). **Note:** This is a justified deviation from AC5.2 (no Ctrl/Alt modifiers). C-c is universally expected as process termination and Zellij passes it through to the child process. Without it, a user who reflexively hits C-c would have no way to exit.

7. Call `screen.render()`

Remove the React/Ink imports (`React`, `render`, `App`). Remove the `App` export. Keep the `TuiDependencies` type re-export.

**Step 2: Verify build**

Run: `bun run build`
Expected: Build succeeds (old screen files may still exist but shouldn't be imported by the new index.ts)

**Step 3: Verify operationally**

Run: `bun start`
Expected: A blessed screen appears with a tab bar showing all 7 tabs. Tab/Shift+Tab cycles between tabs. The placeholder content updates to show the active tab name. `q` quits cleanly. Pressing Escape switches to Sessions.

**Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): replace Ink entry point with neo-blessed screen and tab navigation"
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Verify in Zellij and final cleanup

**Step 1: Test in Zellij**

If Zellij is available, run `bun start` inside a Zellij pane and verify:
- Tab bar renders correctly (no garbled characters)
- Tab/Shift+Tab keys are not intercepted by Zellij in default mode
- Mouse wheel scrolling works (may need Zellij locked mode for some interactions)
- `q` quits cleanly
- No visual artifacts on resize

If Zellij is not available, verify in a standard terminal and note that Zellij testing should be done manually.

**Step 2: Verify all changes build**

Run: `bun run build`
Expected: Succeeds. The old Ink screen files still exist but are no longer imported from `index.ts`, so they should not cause build failures.

Run: `bun test`
Expected: Existing tests pass (the 2 pre-existing failures in `workspace/email/` are unrelated). No new test failures.

**Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(tui): verify neo-blessed infrastructure renders correctly"
```
<!-- END_TASK_6 -->
