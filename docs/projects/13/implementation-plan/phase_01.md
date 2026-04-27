# GH13: Multi-Screen TUI — Phase 1: Types, Navigation Shell, and Wiring

**Goal:** Replace the single-page `App.tsx` with a stack-based navigation shell and thread all dependencies through `startTUI`.

**Architecture:** A `Screen` union type and `TuiDependencies` bag define the contract. `App.tsx` becomes a thin shell that manages a screen stack and delegates rendering to per-screen components. Global key bindings (navigation hotkeys, quit) live in the shell. `startTUI` and `src/index.ts` expand to pass scheduler, custom tools, and system prompt provider into the TUI.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 1 of 7 from GH13 design

**Prerequisites:** This plan assumes the following features are already merged:
- **#2 Event Emission** — `AgentEvent`, `AgentEventKind`, and `onEvent` callback on `ChatOptions`
- **#5 Session Titles** — `maybeGenerateSessionTitle()` and auto-generated session titles in the store
- **#10 Custom Tools** — `CustomToolManager` at `src/tools/custom-tool-manager.ts` with `listTools()`, `getTool()`, `approveTool()`, `revokeTool()`
- **#14 Secrets** — `SecretManager` at `src/secrets/manager.ts` (already exists on `main`)

If any of these are not yet merged, their corresponding screens will render graceful fallbacks (e.g., "Custom tools not available" when `customTools` is undefined).

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH13.AC10: Global navigation keys work from any screen
- **GH13.AC10.1:** Pressing `t` from any screen pushes the tools screen
- **GH13.AC10.2:** Pressing `s` from any screen pushes the secrets screen
- **GH13.AC10.3:** Pressing `c` from any screen pushes the schedules screen
- **GH13.AC10.4:** Pressing `p` from any screen pushes the system prompt screen
- **GH13.AC10.5:** Pressing `q` from any screen quits the application

### GH13.AC11: Escape pops the screen stack
- **GH13.AC11.1:** Pressing Escape from any non-root screen returns to the previous screen
- **GH13.AC11.2:** Pressing Escape on the root (sessions) screen does nothing

### GH13.AC12: All dependencies threaded through from startTUI to individual screens
- **GH13.AC12.1:** `startTUI` accepts `store`, `secrets`, `scheduler`, `customTools`, and `systemPromptProvider`
- **GH13.AC12.2:** Each screen receives only the dependencies it needs via props

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tui/types.ts` — Screen type and TuiDependencies

**Files:**
- Create: `src/tui/types.ts`

**Implementation:**

Create the shared types file that all TUI modules will import:

```typescript
// pattern: Functional Core — TUI shared types

import type { Agent } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';
import type { TaskStore } from '../scheduler/types.ts';

// Screen identifiers for stack-based navigation.
// 'tool-detail' is a sub-screen of the tools screen.
export type Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt';

// All TUI dependencies. Individual screens destructure what they need.
export type TuiDependencies = {
  readonly agent: Agent;
  readonly modelName: string;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: {
    listTools(): Array<{ name: string; description: string; approved: boolean }>;
    approveTool(name: string): void;
    revokeTool(name: string): void;
  };
  readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;
};

// Navigation actions passed to screens as callbacks.
export type NavigationActions = {
  readonly push: (screen: Screen) => void;
  readonly pop: () => void;
};
```

Note: `customTools` is typed as a structural interface rather than importing `CustomToolManager` directly. This avoids a hard dependency on #10's exact export shape and allows the type to compile even if `CustomToolManager` hasn't been implemented yet. When #10 is merged, `CustomToolManager` will satisfy this structural type.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit src/tui/types.ts`
Expected: No type errors

**Commit:** `feat(tui): add Screen and TuiDependencies types`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Refactor `src/tui/App.tsx` into navigation shell

**Verifies:** GH13.AC10.1, GH13.AC10.2, GH13.AC10.3, GH13.AC10.4, GH13.AC10.5, GH13.AC11.1, GH13.AC11.2

**Files:**
- Modify: `src/tui/App.tsx` (full rewrite)

**Implementation:**

Rewrite `App.tsx` to be a navigation shell. The existing chat UI code stays inline for now (it will be extracted in Phase 3). The key changes are:

1. Replace `type Page = 'chat' | 'review'` with a `Screen[]` stack
2. Replace `setPage` with `push`/`pop` navigation helpers
3. Add global key bindings (`t`, `s`, `c`, `p`, `q`) in a `useInput` handler
4. Global nav keys are suppressed when text input is focused (use `isActive` flag that's false when `isThinking` is false and `currentScreen === 'chat'` — actually, global keys must NOT fire when the text input is focused, so we need the inverse: global nav `useInput` is active only when not on the chat screen OR when thinking)
5. Render a placeholder `<Text>` for screens that don't exist yet (sessions, tools, secrets, schedules, prompt)
6. Import `Screen` and `TuiDependencies` from `./types.ts`

Critical detail on key binding conflicts: The chat screen has a `TextInput` that captures all keystrokes. Global nav keys (`t`, `s`, `c`, etc.) must NOT fire when the user is typing a message. The approach:
- The global `useInput` for navigation has `isActive` set to `true` only when `currentScreen !== 'chat'` OR when the chat screen's text input is not focused (i.e., during thinking).
- The chat screen itself will handle Escape to pop back to sessions.

The `AppProps` type expands to use `TuiDependencies`:

```typescript
export type AppProps = TuiDependencies;
```

The component structure:

```typescript
export default function App(deps: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1]!;

  // Chat state (kept here until Phase 3 extracts ChatScreen)
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [inputValue, setInputValue] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const push = useCallback((screen: Screen) => {
    setScreenStack(prev => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  }, []);

  // Global navigation — inactive when chat input is focused
  const globalNavActive = currentScreen !== 'chat' || isThinking;
  useInput((input, key) => {
    if (input === 't') push('tools');
    if (input === 's') push('secrets');
    if (input === 'c') push('schedules');
    if (input === 'p') push('prompt');
    if (input === 'q') { exit(); process.exit(0); }
    if (key.escape) pop();
  }, { isActive: globalNavActive });

  // ... existing chat handlers (handleSubmit, etc.) ...

  switch (currentScreen) {
    case 'sessions':
      return <Text>Sessions screen (Phase 2)</Text>;
    case 'chat':
      return /* existing chat JSX, with Escape handled via a separate useInput */;
    case 'tools':
      return <Text>Tools screen (Phase 4) — press Escape to go back</Text>;
    case 'secrets':
      return <Text>Secrets screen (Phase 5) — press Escape to go back</Text>;
    case 'schedules':
      return <Text>Schedules screen (Phase 6) — press Escape to go back</Text>;
    case 'prompt':
      return <Text>System Prompt screen (Phase 7) — press Escape to go back</Text>;
  }
}
```

For the chat screen case, the existing chat JSX from the current `App.tsx` is used directly. The `/review` command is removed (it's being replaced by the tools screen). The `/quit` command still works. Add Escape handling within the chat screen's own `useInput` to call `pop()` when not in text input mode.

The `handleSubmit` callback also needs the following update for the `/review` command:
- Remove the `if (input === '/review')` block
- Update `/help` to show the new navigation: `Commands: /reset /help /quit | Navigation: t=tools s=secrets c=schedules p=prompt Esc=back`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): refactor App.tsx to stack-based navigation shell`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `src/tui/index.ts` and `src/index.ts` — wiring

**Verifies:** GH13.AC12.1, GH13.AC12.2

**Files:**
- Modify: `src/tui/index.ts`
- Modify: `src/index.ts` (lines 111-115, the TUI launch block)

**Implementation:**

**`src/tui/index.ts`** — Update imports and re-export the new types:

```typescript
// Barrel export + render entry point for the TUI module

import React from 'react';
import { render } from 'ink';
import App from './App.tsx';
import type { TuiDependencies } from './types.ts';

export type { TuiDependencies };
export { App };

/**
 * Render the full-screen TUI application.
 * Call this from the imperative shell (src/index.ts).
 */
export function startTUI(props: TuiDependencies): void {
  render(React.createElement(App, props));
}
```

Remove the old `AppProps` re-export since `TuiDependencies` replaces it.

**`src/index.ts`** — Update the TUI launch block (around lines 111-115) to pass all dependencies:

Replace:
```typescript
const tuiAgent = createAgent({ ...agentDeps, scheduler });
startTUI({ agent: tuiAgent, modelName, store, secrets });
```

With:
```typescript
const tuiAgent = createAgent({ ...agentDeps, scheduler });
startTUI({
  agent: tuiAgent,
  modelName,
  store,
  secrets,
  scheduler,
  // customTools and systemPromptProvider will be wired when #10 and #12 are merged
});
```

The `scheduler` is already available in scope. `customTools` and `systemPromptProvider` are left as `undefined` for now — the screens handle this gracefully.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire TuiDependencies through startTUI and index.ts`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
