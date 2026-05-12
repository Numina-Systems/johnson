# TUI Neo-Blessed Migration — Phase 2: Reusable Widgets

**Goal:** Build three shared widgets (SelectableList, ScrollableViewer, StatusBar) that all views depend on. These wrap neo-blessed primitives with consistent styling, keyboard navigation, and scroll behaviour.

**Architecture:** Each widget is a factory function returning a typed object with the blessed element plus control methods. Widgets use the blessed style objects from `theme.ts`. All three follow Imperative Shell pattern (widget construction, event binding).

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 2 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC2: Scrollable everywhere
- **tui-neo-blessed.AC2.1 Success:** Chat message history scrolls with arrow keys and Page Up/Down
- **tui-neo-blessed.AC2.2 Success:** Chat message history scrolls with mouse wheel
- **tui-neo-blessed.AC2.3 Success:** List screens (Sessions, Tools, Secrets, Schedules, Prune) scroll when content exceeds viewport

### tui-neo-blessed.AC5: Zellij-safe keybindings
- **tui-neo-blessed.AC5.1 Success:** All navigation and interaction works using only arrows, Enter, Escape, Tab, Page Up/Down, F-keys, Space, and single letters

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create selectable-list widget

**Verifies:** tui-neo-blessed.AC2.3, tui-neo-blessed.AC5.1

**Files:**
- Create: `src/tui/widgets/selectable-list.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

Create a factory function that wraps `blessed.list` with consistent styling and event handling.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';
```

Type definitions:

```typescript
type SelectableListOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
  readonly top: string | number;
  readonly left: string | number;
  readonly width: string | number;
  readonly height: string | number;
  readonly label?: string;
};

type SelectableList = {
  readonly element: Widgets.ListElement;
  setItems(items: ReadonlyArray<string>): void;
  getSelectedIndex(): number;
  getSelectedItem(): string | null;
  focus(): void;
  on(event: 'select', listener: (index: number) => void): void;
  on(event: 'highlight', listener: (index: number) => void): void;
  destroy(): void;
};
```

The `createSelectableList` factory should:

1. Create a `blessed.list` with:
   - `parent`, `top`, `left`, `width`, `height` from options
   - `keys: true` (enable keyboard navigation)
   - `mouse: true` (enable mouse click and scroll)
   - `scrollable: true`
   - `scrollbar: { ch: '│', style: { fg: palette.surface1 } }`
   - `tags: true`
   - `style` using blessedStyles: selected items use `blessedStyles.selected`, normal items use `blessedStyles.text`
   - `border: 'line'` with `style.border` using `blessedStyles.border`
   - Optional `label` from options

2. Wrap the blessed list events:
   - `list.on('select')` → emit custom `select` event with index
   - `list.on('select item')` → emit custom `highlight` event with index
   - Arrow keys and Enter are handled by blessed's built-in `keys: true`
   - Mouse click selection is handled by blessed's built-in `mouse: true`

3. `setItems()` should call `list.setItems()` and `screen.render()`
4. `getSelectedIndex()` returns `list.selected` (the current selection index)
5. `getSelectedItem()` returns the content of the selected item or null

**Testing:**

Tests must verify:
- tui-neo-blessed.AC2.3: List scrolls when items exceed viewport height (programmatic verification: set many items, verify `getScrollHeight() > height`)
- tui-neo-blessed.AC5.1: Widget only uses blessed built-in key handling (arrow keys, Enter, mouse) — no Ctrl/Alt bindings

Since neo-blessed widgets require a screen instance, tests should create a minimal `blessed.screen` with `{ input: process.stdin, output: process.stdout }` or verify behaviour through the wrapper's public API. Consider testing the pure logic (index tracking, item management) separately from the widget wiring if direct blessed testing proves problematic.

Follow project test patterns: `bun:test`, `describe`/`test`, `expect()` assertions, requirement IDs in test names.

Test file: `src/tui/widgets/selectable-list.test.ts`

**Verification:**

Run: `bun test src/tui/widgets/selectable-list.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add selectable-list widget with keyboard and mouse navigation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create scrollable-viewer widget

**Verifies:** tui-neo-blessed.AC2.1, tui-neo-blessed.AC2.2, tui-neo-blessed.AC5.1

**Files:**
- Create: `src/tui/widgets/scrollable-viewer.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

Create a factory function wrapping `blessed.box` with scrollable content, keyboard navigation, and auto-scroll detection.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';
```

Type definitions:

```typescript
type ScrollableViewerOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
  readonly top: string | number;
  readonly left: string | number;
  readonly width: string | number;
  readonly height: string | number;
  readonly label?: string;
  readonly alwaysScroll?: boolean;
};

type ScrollableViewer = {
  readonly element: Widgets.BoxElement;
  setContent(content: string): void;
  appendContent(content: string): void;
  scrollToBottom(): void;
  scrollToTop(): void;
  isScrolledToBottom(): boolean;
  getScroll(): number;
  focus(): void;
  destroy(): void;
};
```

The `createScrollableViewer` factory should:

1. Create a `blessed.box` with:
   - `parent`, `top`, `left`, `width`, `height` from options
   - `scrollable: true`
   - `alwaysScroll: true` (or from options)
   - `keys: true`
   - `mouse: true`
   - `scrollbar: { ch: '│', style: { fg: palette.surface1 } }`
   - `tags: true`
   - `style` using `blessedStyles.text` for fg, `palette.base` for bg
   - Optional `border: 'line'` and `label`

2. Bind keyboard navigation:
   - Arrow up/down: scroll by 1 line (blessed handles this with `keys: true`)
   - `'pageup'`/`'pagedown'`: scroll by viewport height
   - `'g'`: scroll to top (jump) — only bind when NOT capturing text input
   - `'G'` (shift+g): scroll to bottom — only bind when NOT capturing text input

3. Auto-scroll detection for `appendContent()`:
   - Before appending, check if viewer `isScrolledToBottom()`
   - If yes, auto-scroll to bottom after append
   - If user has scrolled up manually, do NOT auto-scroll (preserves reading position)
   - `isScrolledToBottom()`: compare `getScroll()` to `getScrollHeight() - height` with a small tolerance (±2 lines)

4. Mouse scrolling is handled by blessed's built-in `mouse: true`

**Testing:**

Tests must verify:
- tui-neo-blessed.AC2.1: Content scrolls with keyboard (verify scroll position changes after programmatic key events)
- tui-neo-blessed.AC2.2: Mouse scroll support is enabled (verify `mouse: true` is set on the element)
- tui-neo-blessed.AC5.1: Only uses arrows, Page Up/Down, g/G — no Ctrl/Alt bindings
- Auto-scroll logic: `isScrolledToBottom()` returns correct values; `appendContent()` auto-scrolls when at bottom and doesn't when scrolled up

Test the auto-scroll logic as a pure function if possible: extract `isAtBottom(scrollPos, scrollHeight, viewHeight)` as a pure helper and test it directly.

Test file: `src/tui/widgets/scrollable-viewer.test.ts`

**Verification:**

Run: `bun test src/tui/widgets/scrollable-viewer.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add scrollable-viewer widget with auto-scroll and keyboard navigation`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Create status-bar widget

**Files:**
- Create: `src/tui/widgets/status-bar.ts`

**Implementation:**

Mark as `// pattern: Imperative Shell`.

Create a simple factory for a bottom-pinned status line.

```typescript
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { palette, blessedStyles } from '../theme.ts';
```

Type definitions:

```typescript
type StatusBarOptions = {
  readonly parent: Widgets.BoxElement | Widgets.Screen;
};

type StatusBar = {
  readonly element: Widgets.BoxElement;
  setText(text: string): void;
  destroy(): void;
};
```

The `createStatusBar` factory should:

1. Create a `blessed.box` with:
   - `parent` from options
   - `bottom: 0, left: 0, width: '100%', height: 1`
   - `tags: true`
   - `style` using `palette.mantle` or `palette.crust` for bg, `blessedStyles.subtext` for fg

2. `setText(text)`: set content and render. Text can include blessed tags for styling.

**Testing:**

StatusBar is trivial (a themed box with setText). Test that:
- `setText()` updates the element's content
- Element is positioned at bottom

Test file: `src/tui/widgets/status-bar.test.ts`

**Verification:**

Run: `bun test src/tui/widgets/status-bar.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): add status-bar widget`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Integration verification

**Step 1: Create widgets directory index**

Create `src/tui/widgets/index.ts` that re-exports all three widgets:

```typescript
export { createSelectableList } from './selectable-list.ts';
export type { SelectableList, SelectableListOptions } from './selectable-list.ts';
export { createScrollableViewer } from './scrollable-viewer.ts';
export type { ScrollableViewer, ScrollableViewerOptions } from './scrollable-viewer.ts';
export { createStatusBar } from './status-bar.ts';
export type { StatusBar, StatusBarOptions } from './status-bar.ts';
```

**Step 2: Verify all widget tests pass**

Run: `bun test src/tui/widgets/`
Expected: All tests pass

**Step 3: Verify build**

Run: `bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/tui/widgets/index.ts
git commit -m "feat(tui): add widgets barrel export"
```
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
