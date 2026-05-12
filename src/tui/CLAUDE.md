# TUI Domain

Last verified: 2026-05-11

## Purpose

Terminal UI for the constellation agent, built on neo-blessed. Provides tabbed navigation across 7 views (Sessions, Chat, Tools, Secrets, Schedules, Prompt, Prune) with a shared event bus for cross-view communication.

## Contracts

- **Exposes**: `startTUI(deps: TuiDependencies) → void` (sole public entry point from `src/index.ts`)
- **Guarantees**: All views implement `ScreenView` (show/hide/focus/destroy + `isCapturingInput`). Only one view is visible at a time. Tab bar reflects active tab and activity indicators. `q` does not quit when a view is capturing input.
- **Expects**: `TuiDependencies` with `agent`, `store`, and `modelName` required; `secrets`, `scheduler`, `customTools`, `toolDocs`, `builtinTools`, `timezone` optional.

## Dependencies

- **Uses**: `neo-blessed` (terminal rendering), `EventEmitter` (event bus), agent domain (`Agent`), store domain (`Store`), secrets domain (`SecretManager`), scheduler domain (`TaskStore`), tools domain (`CustomToolManager`), agent prompt builder (`buildSystemPrompt`)
- **Used by**: `src/index.ts` (imperative shell wiring)
- **Boundary**: Views must not import from each other. Cross-view communication goes through the event bus.

## Key Decisions

- neo-blessed over Ink/React: Eliminates React dependency, direct terminal control, simpler lifecycle (no reconciler). Migration from Ink completed 2026-05-11.
- Factory functions over classes: Each view is `create*View(options) → ScreenView`, returning a closure-based object. No `this` binding, no class hierarchy.
- Event bus over callbacks: `EventEmitter` typed via `TuiEvents` for session selection, tab activity, and message passing between views.
- Catppuccin Macchiato: Single colour palette in `theme.ts`. All views reference semantic `theme` tokens (not raw hex).

## Invariants

- Every view must implement the full `ScreenView` contract including `isCapturingInput`
- Views are indexed in fixed order matching `tabLabels`: Sessions(0), Chat(1), Tools(2), Secrets(3), Schedules(4), Prompt(5), Prune(6)
- Widget factories (`createSelectableList`, `createScrollableViewer`, `createStatusBar`) always accept a `parent` and return a `destroy()` method
- No `.tsx` files -- JSX/React is fully removed from the TUI

## Key Files

- `index.ts` -- Screen setup, tab wiring, key bindings
- `types.ts` -- `ScreenView`, `TuiEvents`, `TuiDependencies`
- `theme.ts` -- Palette, semantic theme, blessed style objects
- `tab-bar.ts` -- Tab bar widget with activity indicators
- `views/` -- One file per view (sessions, chat, tools, secrets, schedules, system-prompt, prune) plus `format.ts` (message formatting, Functional Core)
- `widgets/` -- Reusable blessed primitives (selectable-list, scrollable-viewer, status-bar, scroll-utils)

## Gotchas

- blessed stores list items as objects with `.content`, not plain strings -- `getSelectedItem()` in `SelectableList` handles extraction
- `(element as any).childBase` and `(element as any).selected` are blessed internals not in `@types/blessed` -- used in widgets with explicit casts
- `isCapturingInput` prevents `q` from quitting when a view has a confirmation dialog or text input active
