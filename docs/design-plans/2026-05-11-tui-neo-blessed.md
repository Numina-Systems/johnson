# TUI Neo-Blessed Migration Design

## Summary

The existing TUI is built on Ink — a React-based framework that renders JSX to the terminal. Ink was a reasonable starting point, but its layout model has fundamental limitations: content can't scroll, long output gets clipped by `overflow: hidden`, and all scrollable state has to be managed manually. The result is a chat interface where message history doesn't scroll and long agent responses disappear off-screen. This migration replaces the entire `src/tui/` directory with a neo-blessed implementation, which gives direct control over terminal rendering via absolute-positioned, independently scrollable widgets.

The approach is a full rewrite rather than a hybrid. neo-blessed is structurally incompatible with Ink's React component model, so the two can't coexist incrementally — every Ink screen gets replaced with a neo-blessed view factory function. The external contract (`startTUI(deps)`) is preserved so nothing outside `src/tui/` changes. Inside, the stack-based navigation model is replaced with a persistent tab bar where all seven screens are instantiated at startup and toggled visible/hidden on tab switch. State flows through a typed event bus rather than prop drilling or React context. The project's Functional Core / Imperative Shell pattern is maintained throughout: theme definitions, message formatting, and syntax highlighting are pure functions; view construction and screen wiring are imperative.

## Definition of Done

Replace the entire Ink-based TUI (`src/tui/`) with a neo-blessed implementation that:

1. **Renders all 7 screens** (Sessions, Chat, Tools, Secrets, Schedules, SystemPrompt, Prune) with equivalent functionality to today's Ink-based TUI.
2. **Scrollable everywhere** — Chat history scrolls with keyboard (arrows, Page Up/Down) and mouse. List screens scroll naturally when content exceeds the viewport.
3. **Readable text** — Clear visual separation between user/agent/system messages. Proper text wrapping that doesn't jumble lines together. Syntax highlighting in message display (not input).
4. **Tab bar navigation** — Visible tabs at the top of every screen. Tab/Shift+Tab to cycle between screens. Always visible, always obvious.
5. **Zellij-safe keybindings** — No Ctrl/Alt combos that Zellij intercepts. Navigation uses only arrows, Enter, Escape, Tab, Page Up/Down, and F-keys.
6. **Plain text input** — No styling in the chat input box. Avoids neo-blessed textarea cursor bugs with styled text.
7. **Catppuccin Macchiato colour theme** preserved from existing TUI.
8. **Functional Core / Imperative Shell** architecture throughout.
9. **New features**: multi-line input in chat, message search in chat history, editable system prompt (nice-to-have).
10. **Same external contract** — `startTUI(deps: TuiDependencies)` remains the only export; nothing outside `src/tui/` breaks.

## Acceptance Criteria

### tui-neo-blessed.AC1: All 7 screens render with equivalent functionality
- **tui-neo-blessed.AC1.1 Success:** Sessions screen lists sessions with title, message count, and last activity timestamp
- **tui-neo-blessed.AC1.2 Success:** Chat screen displays conversation history and accepts user input that dispatches to `agent.chat()`
- **tui-neo-blessed.AC1.3 Success:** Tools screen displays three sections (Custom, Built-in, Skills) with code viewing and secret assignment
- **tui-neo-blessed.AC1.4 Success:** Secrets screen lists secret names, supports add/delete, and assigns secrets to skills
- **tui-neo-blessed.AC1.5 Success:** Schedules screen lists tasks with cron expression, run count, and enabled toggle
- **tui-neo-blessed.AC1.6 Success:** SystemPrompt screen displays the current system prompt in a scrollable viewer
- **tui-neo-blessed.AC1.7 Success:** Prune screen shows sessions with checkboxes, classifies selections, and executes archive/delete

### tui-neo-blessed.AC2: Scrollable everywhere
- **tui-neo-blessed.AC2.1 Success:** Chat message history scrolls with arrow keys and Page Up/Down
- **tui-neo-blessed.AC2.2 Success:** Chat message history scrolls with mouse wheel
- **tui-neo-blessed.AC2.3 Success:** List screens (Sessions, Tools, Secrets, Schedules, Prune) scroll when content exceeds viewport
- **tui-neo-blessed.AC2.4 Success:** Auto-scroll to bottom on new messages unless user has scrolled up manually

### tui-neo-blessed.AC3: Readable text
- **tui-neo-blessed.AC3.1 Success:** User, agent, and system messages are visually distinct via colour-coded role labels
- **tui-neo-blessed.AC3.2 Success:** Messages are separated by blank lines — no jumbling between adjacent messages
- **tui-neo-blessed.AC3.3 Success:** Agent responses with fenced code blocks display syntax-highlighted output

### tui-neo-blessed.AC4: Tab bar navigation
- **tui-neo-blessed.AC4.1 Success:** Tab bar is visible at top of every screen showing all 7 tab labels
- **tui-neo-blessed.AC4.2 Success:** Tab/Shift+Tab cycles between tabs in order, wrapping at ends
- **tui-neo-blessed.AC4.3 Failure:** Tab switching does not interrupt an in-progress `agent.chat()` call

### tui-neo-blessed.AC5: Zellij-safe keybindings
- **tui-neo-blessed.AC5.1 Success:** All navigation and interaction works using only arrows, Enter, Escape, Tab, Page Up/Down, F-keys, Space, and single letters
- **tui-neo-blessed.AC5.2 Failure:** No keybinding uses Ctrl or Alt modifier (except Shift+Enter for multi-line in Zellij locked mode)

### tui-neo-blessed.AC6: Plain text input
- **tui-neo-blessed.AC6.1 Success:** Chat input box accepts and displays plain text without styling or ANSI codes

### tui-neo-blessed.AC7: Catppuccin Macchiato theme
- **tui-neo-blessed.AC7.1 Success:** All UI elements use colours from the Catppuccin Macchiato palette
- **tui-neo-blessed.AC7.2 Success:** Semantic colour slots (userMsg, agentMsg, accent, error, etc.) map to the same palette colours as the existing Ink TUI

### tui-neo-blessed.AC8: Functional Core / Imperative Shell
- **tui-neo-blessed.AC8.1 Success:** Theme, types, syntax highlighting, and message formatting modules are pure functions with no side effects
- **tui-neo-blessed.AC8.2 Success:** View factories, index wiring, and widget constructors are annotated as Imperative Shell

### tui-neo-blessed.AC9: New features
- **tui-neo-blessed.AC9.1 Success:** Chat input supports multi-line via Shift+Enter (in Zellij locked mode)
- **tui-neo-blessed.AC9.2 Success:** F5 opens search overlay in chat that matches text and scrolls to first result
- **tui-neo-blessed.AC9.3 Success (nice-to-have):** F4 in SystemPrompt view opens editable textarea for prompt modification

### tui-neo-blessed.AC10: Same external contract
- **tui-neo-blessed.AC10.1 Success:** `startTUI(deps: TuiDependencies)` remains the only export from `src/tui/`; `src/index.ts` requires no changes beyond the import

## Glossary

- **neo-blessed**: A maintained fork of the `blessed` Node.js library. Provides a curses-style terminal widget toolkit with direct control over positioning, scrolling, and input handling. Unlike Ink, it does not use React or a virtual DOM.
- **Ink**: A React-based library for building terminal UIs. Renders JSX component trees to stdout using Yoga's flexbox layout engine. The existing TUI is built on Ink; this document describes replacing it.
- **blessed tagged strings**: neo-blessed's inline markup syntax for styled terminal text. Tags like `{bold}`, `{#8aadf4-fg}`, and `{/}` are embedded in strings and interpreted at render time.
- **`blessed.screen`**: The root object in a neo-blessed application. Owns the terminal session, processes all input events, and coordinates redraws. Exactly one per process.
- **`blessed.textarea`**: A neo-blessed widget for editable text input. Has known cursor-positioning bugs when content contains ANSI escape codes — relevant to the plain-text input constraint.
- **Functional Core / Imperative Shell (FCIS)**: Architectural pattern used throughout this codebase. Pure functions go in the Functional Core; I/O, event binding, and widget construction go in the Imperative Shell. Files are annotated with `// pattern:` comments.
- **`ScreenView`**: The shared contract type for all seven views. Defines `show()`, `hide()`, `focus()`, `destroy()`, and `isCapturingInput` so the tab bar can manage views without knowing their internals.
- **`TuiEvents`**: A typed EventEmitter bus carrying domain events between views without direct cross-view references.
- **`TuiDependencies`**: The struct of external services (agent, store, secrets manager, etc.) injected into the TUI at startup. Preserved unchanged from the existing Ink implementation.
- **Catppuccin Macchiato**: A pastel dark colour scheme. The existing TUI uses it; this migration preserves the same semantic colour slots mapped to the same palette colours.
- **Zellij**: A terminal multiplexer that intercepts many Ctrl/Alt key combinations before they reach applications running inside it. The keybinding constraints in this design are driven by Zellij compatibility.
- **Zellij locked mode**: An input passthrough mode (`Ctrl+G`) where Zellij forwards all keystrokes directly to the focused pane. Required for Shift+Enter (multi-line input).
- **cli-highlight**: A library that applies syntax highlighting to code strings using ANSI escape codes. Used to highlight fenced code blocks in agent responses. Preserved as-is because blessed renders ANSI natively.
- **visibility toggling**: The tab-switching strategy. All views are instantiated once at startup; switching tabs calls `hide()` on the current view and `show()` on the next. Cheaper than destroy/recreate.
- **view factory function**: The construction pattern for each screen. A function that takes dependencies, creates blessed widgets, wires key bindings and event subscriptions, and returns a `ScreenView`. Not a class.
- **activity indicator**: A `*` appended to a tab label when that screen has received an update while it wasn't active. Cleared when the user visits that tab.

## Architecture

Single `blessed.screen` instance owns the entire TUI. Seven view factories create all UI elements at startup. Tab switching toggles visibility (`show()`/`hide()`) rather than creating/destroying elements — blessed tracks rendering damage and only redraws changed regions, making visibility toggling cheap.

State flows through a typed `EventEmitter` bus. Views subscribe to domain events (`message:new`, `session:selected`, `tab:activity`) and update their own blessed elements in response. No cross-view direct references.

### Contracts

```typescript
type ScreenView = {
  readonly name: string;
  readonly container: Widgets.BoxElement;
  readonly isCapturingInput: boolean;
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
};

type TuiEvents = {
  'message:new': { role: 'user' | 'agent' | 'system'; text: string };
  'message:status': { status: string };
  'session:selected': { sessionId: string };
  'session:changed': void;
  'tab:activity': { tab: string };
};

// TuiDependencies preserved from existing code — same shape, re-exported.
```

### Layout Model

Blessed uses absolute positioning with percentage-based sizing. Every view occupies `top: 1` (below tab bar) through `bottom: 0`. Views manage their own internal layout — the shared infrastructure only provides the tab bar and screen-level key bindings.

```
┌──────────────────────────────────────────┐
│ Tab Bar (top: 0, height: 1)              │  ← shared, always visible
├──────────────────────────────────────────┤
│                                          │
│ Active View (top: 1, bottom: 0)          │  ← one of 7 views
│                                          │
└──────────────────────────────────────────┘
```

### File Structure

```
src/tui/
├── index.ts              — entry point: creates screen, bus, views, tab bar
├── types.ts              — ScreenView, TuiDependencies, TuiEvents
├── tab-bar.ts            — tab bar widget (blessed.box)
├── theme.ts              — Catppuccin Macchiato as blessed style objects
├── syntax.ts             — preserved; cli-highlight ANSI works in blessed
├── util.ts               — preserved helpers (parseDescription, formatDate)
├── widgets/
│   ├── selectable-list.ts — wraps blessed.list with consistent styling
│   ├── scrollable-viewer.ts — wraps blessed.box scrollable
│   └── status-bar.ts     — bottom status line
└── views/
    ├── chat.ts            — conversation interface (critical path)
    ├── sessions.ts        — session list (home screen)
    ├── tools.ts           — skills, custom tools, built-in tools
    ├── secrets.ts         — secret vault management
    ├── schedules.ts       — scheduled task list
    ├── system-prompt.ts   — prompt viewer (+ editable, nice-to-have)
    └── prune.ts           — multi-select session pruner
```

### Tab Bar & Navigation

Tab bar is a `blessed.box` pinned at `top: 0, height: 1, width: '100%'`. Renders tab labels horizontally with active tab highlighted (accent colour, bold) and inactive tabs dimmed.

```
 Sessions │ Chat │ Tools │ Secrets │ Schedules │ Prompt │ Prune
```

`Tab`/`Shift+Tab` bound at screen level (global), works regardless of focused widget. Activity indicator (`*`) appears on tabs with pending updates (e.g., new message arrives while viewing Tools).

`Escape` is context-aware: exits sub-mode first (e.g., code viewer in Tools), then switches to Sessions. `q` quits globally but only when the active view's `isCapturingInput` is `false`.

### Chat View

Three zones stacked vertically:

| Zone | Widget | Height | Purpose |
|------|--------|--------|---------|
| Message history | `blessed.box` scrollable | `100% - 3` | Scrollable chat log with syntax highlighting |
| Input | `blessed.textarea` | `1` (grows with multi-line) | Plain text, Enter sends, Shift+Enter newline |
| Status bar | `blessed.box` | `1` | Ready / Thinking... / Round N / token stats |

Messages rendered as blessed tagged strings with blank line separation:
- User: `{bold}{#8aadf4-fg}you>{/} message text`
- Agent: `{bold}{#a6da95-fg}agent>{/} highlighted markdown`
- System: `{#6e738d-fg}[system] text{/}`

Auto-scrolls to bottom on new messages unless user has scrolled up (detected by comparing `getScroll()` to `getScrollHeight()`). Page Up/Down and arrow keys scroll the history. Mouse scrolling enabled.

Search (F5): overlay box at top of history with text input. String-matches against message content, scrolls to first match, highlights occurrences. Escape dismisses.

### Reusable Widgets

**SelectableList** — wraps `blessed.list`. Arrow keys navigate, Enter selects, mouse click selects. Scrolls automatically when content exceeds viewport. Emits `select` and `highlight` events. Used by Sessions, Tools, Secrets, Schedules, Prune.

**ScrollableViewer** — wraps `blessed.box` with `scrollable: true`. Arrow keys and Page Up/Down scroll. `g`/`G` jump to top/bottom (only when parent view is not capturing text input). Used by Chat (message history), SystemPrompt, Tools (code viewer).

**StatusBar** — `blessed.box` pinned at `bottom: 0, height: 1`. Accepts themed status text. Updated via event bus.

### Other Views

**Sessions** — SelectableList of sessions showing title, message count, last activity time. Enter opens session (selects session + switches to Chat tab). `n` creates new session. `d` deletes with confirmation prompt.

**Tools** — SelectableList with three sections: Custom, Built-in, Skills. Left/Right arrows cycle sections (distinct from global Tab for screen switching). Code viewing opens a ScrollableViewer overlay. Secret assignment uses a checkbox sub-mode.

**Secrets** — SelectableList of secret names (values never displayed). `a` opens inline text input for adding name then value. `d` deletes with confirmation. `s` opens checkbox list for assigning secrets to skills/tools.

**Schedules** — SelectableList of scheduled tasks showing cron expression, run count, last status. `e` toggles enabled state. Read-only otherwise.

**SystemPrompt** — ScrollableViewer displaying the current system prompt. Nice-to-have: F4 opens editable textarea overlay; Escape saves changes and returns to viewer.

**Prune** — SelectableList with checkboxes (Space toggles selection). `a` selects stale sessions. Enter shows classification breakdown (delete/archive/active counts) and confirms execution.

### Keybinding Constraints

All keybindings are Zellij-safe in default (non-locked) mode:

| Key | Scope | Action |
|-----|-------|--------|
| Tab / Shift+Tab | Global | Cycle tabs |
| Escape | Global | Exit sub-mode, then go to Sessions |
| q | Global (when not capturing input) | Quit |
| Arrow Up/Down | Per-widget | Navigate lists, scroll text |
| Page Up/Down | Per-widget | Page scroll |
| Enter | Per-widget | Select / submit |
| Space | Prune view | Toggle checkbox |
| g / G | ScrollableViewer (when not capturing input) | Jump to top / bottom |
| n / d / a / e / s | Per-view | View-specific actions |
| F5 | Chat view | Open search overlay |
| F4 | SystemPrompt view | Toggle editable mode (nice-to-have) |
| Shift+Enter | Chat input (Zellij locked mode) | Insert newline |

## Existing Patterns

The current TUI follows consistent patterns that this migration preserves:

- **`// pattern: Functional Core` / `// pattern: Imperative Shell`** file-level annotations. All new files follow this convention. Theme, types, syntax highlighting, message formatting are Functional Core. View factories, index wiring, widget constructors are Imperative Shell.
- **`TuiDependencies`** type in `src/tui/types.ts` collects all external dependencies. Individual views destructure what they need. This contract is preserved exactly.
- **Semantic colour theme** in `src/tui/theme.ts` maps palette colours to domain roles (userMsg, agentMsg, grantOk, etc.). Adapted from hex strings to blessed style objects `{ fg: '#hex', bold: true }` but same semantic structure.
- **`src/tui/syntax.ts`** uses `cli-highlight` with a Catppuccin chalk theme. Preserved as-is — `cli-highlight` outputs ANSI escape codes that blessed renders natively within tagged content.

Divergence from existing patterns:
- **Stack-based navigation → tab-based navigation.** The current `App.tsx` maintains a `screenStack: Screen[]` and renders only the top. The new design uses a flat tab model with visibility toggling. Justified by: tab bar is more discoverable, removes hidden navigation state, and aligns with the "easy and obvious" goal.
- **React/JSX → imperative blessed API.** Eliminates Ink's layout limitations (no scrolling, `overflow: hidden` clipping) which are the primary motivation for this migration.
- **`useInput()` hooks → `screen.key()` / `element.key()` bindings.** Blessed's event model is fundamentally different but maps cleanly: global bindings go on `screen`, per-widget bindings go on the element.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Infrastructure & Shared Foundation

**Goal:** Install neo-blessed, set up the screen, tab bar, and adapted theme. Verify blessed renders in Zellij.

**Components:**
- `package.json` — add `neo-blessed`, `@types/blessed` dependencies
- `src/tui/index.ts` — rewrite entry point: create `blessed.screen`, instantiate tab bar, call `screen.render()`
- `src/tui/types.ts` — update with `ScreenView` interface, `TuiEvents` type, preserve `TuiDependencies`
- `src/tui/theme.ts` — adapt palette exports to blessed style objects alongside existing hex strings
- `src/tui/tab-bar.ts` — new: tab bar widget with Tab/Shift+Tab cycling

**Dependencies:** None (first phase)

**Done when:** `bun start` launches a blessed screen with a visible tab bar, tabs cycle with Tab/Shift+Tab, renders correctly inside Zellij, and `q` quits cleanly
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Reusable Widgets

**Goal:** Build the three shared widgets that all views depend on.

**Components:**
- `src/tui/widgets/selectable-list.ts` — wraps `blessed.list` with arrow navigation, Enter select, mouse click, scroll, themed styling
- `src/tui/widgets/scrollable-viewer.ts` — wraps `blessed.box` scrollable with Page Up/Down, g/G jump, auto-scroll detection
- `src/tui/widgets/status-bar.ts` — bottom status line widget

**Dependencies:** Phase 1 (screen + theme)

**Covers:** tui-neo-blessed.AC2.1, tui-neo-blessed.AC2.2, tui-neo-blessed.AC2.3, tui-neo-blessed.AC5.1

**Done when:** Widgets can be instantiated on the blessed screen, list navigates and selects items, viewer scrolls content with keyboard and mouse, status bar renders themed text. Tests verify keyboard navigation, scroll behaviour, and selection events.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Sessions View & Event Bus

**Goal:** First real view — session listing with navigation to chat. Establishes the event bus pattern.

**Components:**
- `src/tui/views/sessions.ts` — factory function returning `ScreenView`. Uses SelectableList to display sessions from Store. Handles `n` (new), `d` (delete with confirm), Enter (select session + emit event).
- Event bus instantiation in `src/tui/index.ts` — typed EventEmitter created and passed to views

**Dependencies:** Phase 2 (SelectableList widget)

**Covers:** tui-neo-blessed.AC1.1, tui-neo-blessed.AC4.1, tui-neo-blessed.AC8.1

**Done when:** Sessions view renders session list with title/count/timestamp, arrow keys navigate, Enter emits `session:selected`, `n` creates session, `d` deletes with confirmation, tab bar correctly shows Sessions as active. Tests verify list rendering, selection events, and create/delete flows.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Chat View

**Goal:** The critical screen — scrollable message history, plain text input, agent integration, status updates.

**Components:**
- `src/tui/views/chat.ts` — factory function returning `ScreenView`. Three-zone layout: ScrollableViewer for history, `blessed.textarea` for input, StatusBar for state. Wires `agent.chat()` with event callbacks. Message formatting as blessed tagged strings with syntax highlighting via `syntax.ts`.

**Dependencies:** Phase 3 (event bus, session selection)

**Covers:** tui-neo-blessed.AC1.2, tui-neo-blessed.AC2.1, tui-neo-blessed.AC2.2, tui-neo-blessed.AC3.1, tui-neo-blessed.AC3.2, tui-neo-blessed.AC3.3, tui-neo-blessed.AC6.1, tui-neo-blessed.AC9.1

**Done when:** Messages display with clear role-based colouring and blank-line separation. History scrolls with arrows, Page Up/Down, and mouse. Auto-scrolls to bottom on new messages unless user scrolled up. Input accepts plain text, Enter sends, Shift+Enter inserts newline. Status bar updates through agent lifecycle events. Syntax highlighting renders in agent responses. Tests verify message formatting, scroll behaviour, auto-scroll logic, input submission, and status transitions.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Tools, Secrets & Schedules Views

**Goal:** Three management views covering tool/skill review, secret vault, and scheduled tasks.

**Components:**
- `src/tui/views/tools.ts` — three-section SelectableList (Custom, Built-in, Skills) with Left/Right section cycling. ScrollableViewer overlay for code viewing. Checkbox sub-mode for secret assignment. Reads from Store and CustomToolManager.
- `src/tui/views/secrets.ts` — SelectableList of secret names. Inline text input for adding (name then value). Delete with confirmation. Checkbox sub-mode for skill assignment. Reads from SecretManager.
- `src/tui/views/schedules.ts` — SelectableList of scheduled tasks. `e` toggles enabled state. Reads from TaskStore.

**Dependencies:** Phase 2 (widgets), Phase 1 (theme)

**Covers:** tui-neo-blessed.AC1.3, tui-neo-blessed.AC1.4, tui-neo-blessed.AC1.5

**Done when:** Tools view shows three sections with section cycling, code viewer displays syntax-highlighted skill code, secret assignment checkboxes work. Secrets view lists names, adds new secrets via inline input, deletes with confirmation. Schedules view lists tasks with cron/status, toggles enabled state. Tests verify section cycling, sub-mode transitions, and CRUD operations.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: SystemPrompt & Prune Views

**Goal:** Remaining two views — prompt inspection and session pruning.

**Components:**
- `src/tui/views/system-prompt.ts` — ScrollableViewer displaying current system prompt fetched via callback. Nice-to-have: F4 toggles editable textarea overlay.
- `src/tui/views/prune.ts` — SelectableList with checkboxes (Space toggles). `a` selects stale sessions. Enter shows classification breakdown and confirms. Executes archive/delete via Store.

**Dependencies:** Phase 2 (widgets)

**Covers:** tui-neo-blessed.AC1.6, tui-neo-blessed.AC1.7

**Done when:** SystemPrompt view renders scrollable prompt text with keyboard/mouse scroll. Prune view shows sessions with checkboxes, classifies selections, confirms before executing, displays results. Tests verify checkbox toggling, classification display, and archive/delete execution.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Chat Search & Polish

**Goal:** Search overlay for chat history, activity indicators on tabs, and UX polish across all views.

**Components:**
- Search overlay in `src/tui/views/chat.ts` — F5 opens text input overlay at top of history. String-matches messages, scrolls to first match, highlights occurrences. Escape dismisses.
- Tab activity indicators in `src/tui/tab-bar.ts` — `*` on tabs with pending updates, cleared when tab is visited.
- Polish: consistent focus management across view transitions, resize handling, edge cases (empty lists, no sessions, long messages).

**Dependencies:** Phases 3–6 (all views)

**Covers:** tui-neo-blessed.AC9.2, tui-neo-blessed.AC4.2

**Done when:** F5 opens search overlay, typing filters matches, Escape dismisses. Tab activity indicators appear on message arrival and clear on visit. All views handle edge cases (empty state, resize). Tests verify search match/scroll, activity indicator lifecycle, and edge case rendering.
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Ink Removal & Cleanup

**Goal:** Remove Ink dependencies, delete old screen files, verify clean build.

**Components:**
- Remove `ink`, `ink-spinner`, `ink-text-input`, `react`, `@types/react` from `package.json`
- Delete `src/tui/screens/` directory (old Ink-based screens)
- Delete `src/tui/App.tsx` (old React navigation shell)
- Delete `src/tui/ScreenLayout.tsx` (old layout component)
- Delete `src/tui/StatusBar.tsx` (replaced by `widgets/status-bar.ts`)
- Update `src/index.ts` if `startTUI` signature changed

**Dependencies:** Phase 7 (all functionality complete)

**Covers:** tui-neo-blessed.AC10.1

**Done when:** `bun run build` succeeds with no Ink/React imports. `bun test` passes. `bun start` launches the neo-blessed TUI. No dead code remains from the Ink implementation.
<!-- END_PHASE_8 -->

## Additional Considerations

**Zellij interaction:** Shift+Enter for multi-line input requires Zellij locked mode (`Ctrl+G`). This is Zellij's intended workflow for TUI apps and documented in their colliding-keybindings tutorial. All other keybindings work in Zellij's default mode.

**Mouse events:** Blessed passes mouse events through for scrolling and clicking. In Zellij, mouse capture in the TUI may prevent terminal-level text selection — this is a known Zellij behaviour, not a bug. Users can use locked mode for full mouse passthrough.

**neo-blessed textarea limitations:** Known cursor positioning bugs when using `setValue()` with chalk-styled text. The design avoids this by keeping the input box unstyled (plain text only). Syntax highlighting is applied only in the message display area, which uses tagged strings in a non-editable box.

**Graceful degradation:** If `cli-highlight` is unavailable (current build failure with missing dependency), agent messages render as plain text without syntax highlighting. The TUI remains functional.
