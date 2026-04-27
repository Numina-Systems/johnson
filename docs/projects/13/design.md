# #13 — Multi-Screen TUI

**Issue:** https://github.com/Numina-Systems/johnson/issues/13
**Wave:** 3 (depends on: #2 events, #5 session titles, #10 custom tools, #14 secrets)

## Current State

Single `App.tsx` with `useState<'chat' | 'review'>`. Chat page has message list + input. Review page manages skill grants. No session management, no tools management, no secrets UI, no schedule visibility.

## Design

### Navigation Model

Stack-based screen management. Sessions screen is the root. Pushing a screen preserves the previous; `Escape` pops back.

```typescript
type Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt';
```

Global key bindings from any screen:
- `t` — tools screen
- `s` — secrets screen
- `c` — schedules screen
- `p` ��� system prompt screen
- `q` — quit

These push onto the stack (don't replace). `Escape` always pops.

### App Shell (`src/tui/App.tsx`)

Refactored from the current monolithic component to a navigation shell:

```tsx
function App(props: AppProps) {
  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1];

  // Global key handler for navigation
  useInput((input, key) => {
    if (input === 't') push('tools');
    if (input === 's') push('secrets');
    // ... etc
    if (key.escape) pop();
  });

  // Render current screen
  switch (currentScreen) {
    case 'sessions': return <SessionsScreen {...} />;
    case 'chat': return <ChatScreen {...} />;
    // ... etc
  }
}
```

### Screens

#### Sessions Screen (`src/tui/screens/SessionsScreen.tsx`)

Landing screen. Lists all sessions from `store.listSessions()`.

- Header: model name, secret count, custom tool count (approved/total), schedule count
- Session list: title (auto-generated from #5), created date, message count
- Keybindings: `n` = new session, `d` = delete selected, `Enter` = open in chat
- Opening a session pushes the chat screen with that session's ID

#### Chat Screen (`src/tui/screens/ChatScreen.tsx`)

Refactored from current `App.tsx` chat page.

- Message list with user/agent/system roles (existing)
- Input field at bottom (existing)
- **New: Event-driven status indicators** (from #2):
  - `llm_start` → show "Thinking..." with spinner
  - `llm_done` → update token stats bar
  - `tool_start` → show "Running code..." with tool name
  - `tool_done` → show success/failure indicator
- Token stats bar: input/output tokens, rounds, duration (from `ChatStats`)
- Passes `onEvent` callback and `sessionId` to `agent.chat()`
- `Escape` = back to sessions
- `/reset`, `/help` commands still work

#### Tools Screen (`src/tui/screens/ToolsScreen.tsx`)

Manages custom tools from `CustomToolManager` (#10). Absorbs existing `ReviewPage.tsx` functionality.

- Section 1: Custom tools — name, description, approval status
  - `a` = approve selected tool
  - `r` = revoke selected tool
  - `Enter` = view tool detail (code, parameters, secrets)
- Section 2: Built-in tools — name, description (read-only)
- Section 3: Skills (existing grant management from ReviewPage)
  - Same approve/revoke flow as current `/review`

#### Secrets Screen (`src/tui/screens/SecretsScreen.tsx`)

Manages secrets from `SecretManager` (#14).

- Lists secret names (never values)
- `a` = add new secret (prompts for name, then value — value hidden during input)
- `d` = delete selected secret
- Shows which tools/skills reference each secret (if discoverable from custom tool declarations)

#### Schedules Screen (`src/tui/screens/SchedulesScreen.tsx`)

Lists scheduled tasks from scheduler.

- Name, schedule expression, enabled/disabled, last run time, last run status, run count
- `e` = toggle enabled/disabled
- Read-only otherwise (tasks are created by the agent, not the operator)

#### System Prompt Screen (`src/tui/screens/SystemPromptScreen.tsx`)

Displays the current assembled system prompt. Read-only, scrollable.

- Calls `systemPromptProvider(toolDocs)` (from #12) to get the current prompt
- Scrollable text view
- Useful for debugging what the agent sees

### Props

`startTUI()` signature expands:

```typescript
function startTUI(props: {
  agent: Agent;
  modelName: string;
  store: Store;
  secrets?: SecretManager;
  scheduler?: TaskStore;
  customTools?: CustomToolManager;
  systemPromptProvider?: (toolDocs: string) => Promise<string>;
}): void
```

### Types

New `src/tui/types.ts`:

```typescript
type Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt';

type TuiDependencies = {
  readonly agent: Agent;
  readonly modelName: string;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: CustomToolManager;
  readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;
};
```

## Files Touched

- `src/tui/App.tsx` — refactor to navigation shell
- `src/tui/types.ts` — new file, Screen type, TuiDependencies
- `src/tui/screens/SessionsScreen.tsx` — new
- `src/tui/screens/ChatScreen.tsx` — new (extracted from App.tsx)
- `src/tui/screens/ToolsScreen.tsx` — new (absorbs ReviewPage.tsx)
- `src/tui/screens/SecretsScreen.tsx` — new
- `src/tui/screens/SchedulesScreen.tsx` — new
- `src/tui/screens/SystemPromptScreen.tsx` — new
- `src/tui/ReviewPage.tsx` — removed (absorbed into ToolsScreen)
- `src/tui/index.ts` — update startTUI signature
- `src/index.ts` — pass all deps to startTUI

## Acceptance Criteria

1. Sessions screen lists sessions with titles and dates
2. New session creation works, opens chat screen
3. Chat screen shows real-time event indicators (thinking, running, token stats)
4. Tools screen lists custom tools with approve/revoke actions
5. Tools screen lists built-in tools (read-only)
6. Tools screen handles skill grant management (existing ReviewPage functionality preserved)
7. Secrets screen lists/adds/deletes secrets (values never displayed)
8. Schedules screen lists tasks with enable/disable toggle
9. System prompt screen shows current assembled prompt (scrollable)
10. Global navigation keys work from any screen
11. Escape pops the screen stack
12. All dependencies threaded through from startTUI to individual screens
