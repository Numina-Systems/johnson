# Bubbletea TUI Implementation Plan — Phase 2: Sessions & Navigation Shell

**Goal:** Build the Go TUI shell with screen navigation and the sessions screen, plus TS handlers for session operations.

**Architecture:** Root model delegates to screen-specific models via state-based routing. Sessions screen uses bubbles list component. TS backend gains session JSON-RPC handlers with cursor-based pagination (new Store methods added to support this — existing `listSessions` and `getMessages` lack cursors).

**Tech Stack:** Go 1.26, bubbletea v2 (charm.land/bubbletea/v2), bubbles v2 (charm.land/bubbles/v2), lipgloss v2 (charm.land/lipgloss/v2), TypeScript/Bun

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.2 Success:** All 20 request methods return well-formed JSON-RPC responses with correct data
- **bubbletea-tui.AC1.4 Success:** `session/messages` supports cursor-based pagination (returns next cursor when more messages exist, empty cursor at end)
- **bubbletea-tui.AC1.5 Failure:** Malformed JSON-RPC requests return standard error response (code -32600)
- **bubbletea-tui.AC1.6 Failure:** Unknown method returns method-not-found error (code -32601)

### bubbletea-tui.AC2: Go TUI implements all screens with hybrid layout
- **bubbletea-tui.AC2.5 Success:** Sessions screen lists sessions with message counts, supports create/delete
- **bubbletea-tui.AC2.10 Success:** Screen navigation works via ctrl+ keybindings and escape to go back

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.1 Success:** JSON-RPC server translates requests to existing Store/Agent/SecretManager/Scheduler/CustomToolManager calls without modifying business logic

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
**Note: Tasks 1 and 2 must be executed sequentially — Task 2 depends on the Store pagination methods created in Task 1.**

<!-- START_TASK_1 -->
### Task 1: Add cursor-based pagination to Store for sessions and messages

**Verifies:** bubbletea-tui.AC1.4

**Files:**
- Modify: `src/store/store.ts:440-472` — add `listSessionsPaginated` and `getMessagesPaginated` methods

**Implementation:**

Add two new paginated methods to the Store class, following the existing `docList()` pattern at lines 364-386 which already implements keyset pagination. Do NOT modify the existing `listSessions()` or `getMessages()` methods — the Ink TUI still uses them.

`listSessionsPaginated(limit?: number, cursor?: string)` — returns `{ sessions: Array<{ id: string; title: string | null; updatedAt: string; messageCount: number }>, cursor?: string }`. Uses keyset pagination on `updated_at` + `id` (since `updated_at` is not unique). The cursor is the `updated_at|id` of the last row. Include a subquery or join to get `messageCount` inline to avoid N+1.

`getMessagesPaginated(sessionId: string, limit?: number, cursor?: string)` — returns `{ messages: Array<{ id: number; role: string; content: string; createdAt: string }>, cursor?: string }`. Uses keyset pagination on the autoincrement `id` column. Note: the existing `getMessages()` does NOT return `id` — this new method does.

The pagination pattern: fetch `limit + 1` rows. If you get more than `limit`, pop the extra row and return its key as the next cursor. If you get `limit` or fewer, return no cursor (end of data).

**Testing:**

Tests must verify:
- bubbletea-tui.AC1.4: Paginated session list returns cursor when more exist, no cursor at end
- bubbletea-tui.AC1.4: Paginated message list returns cursor when more exist, no cursor at end
- Edge: empty session list returns empty array and no cursor
- Edge: cursor from first page works as input to get second page

Follow the existing test pattern in the project: co-located test file `src/store/store.test.ts` if it exists, otherwise create `src/store/pagination.test.ts`. Use `bun:test` with temp database setup.

**Verification:**

```bash
bun test src/store/
```

Expected: All tests pass.

**Commit:** `feat(store): add cursor-based pagination for sessions and messages`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: TS JSON-RPC handlers for session operations

**Verifies:** bubbletea-tui.AC1.2, bubbletea-tui.AC3.1

**Files:**
- Modify: `src/jsonrpc/types.ts` — add session request/response types
- Modify: `src/jsonrpc/handlers.ts` — add session handlers, update `JsonRpcDependencies`

**Implementation:**

Add to `src/jsonrpc/types.ts`:

```typescript
export type SessionListParams = {
  readonly limit?: number;
  readonly cursor?: string;
};

export type SessionListResult = {
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly updatedAt: string;
    readonly messageCount: number;
  }>;
  readonly cursor?: string;
};

export type SessionCreateParams = {
  readonly title?: string;
};

export type SessionCreateResult = {
  readonly id: string;
};

export type SessionDeleteParams = {
  readonly id: string;
};

export type SessionDeleteResult = {
  readonly ok: boolean;
};

export type SessionMessagesParams = {
  readonly sessionId: string;
  readonly limit?: number;
  readonly cursor?: string;
};

export type SessionMessagesResult = {
  readonly messages: ReadonlyArray<{
    readonly id: number;
    readonly role: string;
    readonly content: string;
    readonly createdAt: string;
  }>;
  readonly cursor?: string;
};
```

Update `src/jsonrpc/handlers.ts`:

- Add `store` to `JsonRpcDependencies` type (import `Store` from `../store/store.ts`)
- Register four handlers:
  - `session/list` — calls `store.listSessionsPaginated(params.limit, params.cursor)` and returns the result
  - `session/create` — generates a UUID via `crypto.randomUUID()`, calls `store.createSession(id, params.title)`, returns `{ id }`
  - `session/delete` — calls `store.deleteSession(params.id)`, returns `{ ok: result }`
  - `session/messages` — calls `store.getMessagesPaginated(params.sessionId, params.limit, params.cursor)` and returns the result

Update `src/index.ts` to pass `store` into `JsonRpcDependencies` when creating the jsonrpc handlers.

**Testing:**

Tests must verify:
- bubbletea-tui.AC1.2: Each handler returns well-formed response matching its result type
- bubbletea-tui.AC3.1: Handlers correctly delegate to Store methods
- bubbletea-tui.AC1.5: Already covered by Phase 1 server.ts (malformed request → -32600)
- bubbletea-tui.AC1.6: Already covered by Phase 1 server.ts (unknown method → -32601)

Create test file `src/jsonrpc/handlers.test.ts`. Use mock Store with the paginated methods. Verify each handler returns the expected shape.

**Verification:**

```bash
bun test src/jsonrpc/
```

Expected: All tests pass.

**Commit:** `feat(jsonrpc): add session handlers with cursor-based pagination`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Go protocol types for session operations

**Files:**
- Modify: `tui/internal/protocol/types.go` — add session request/response types

**Implementation:**

Add to `tui/internal/protocol/types.go`:

```go
type SessionListParams struct {
	Limit  int    `json:"limit,omitempty"`
	Cursor string `json:"cursor,omitempty"`
}

type SessionRow struct {
	ID           string  `json:"id"`
	Title        *string `json:"title"`
	UpdatedAt    string  `json:"updatedAt"`
	MessageCount int     `json:"messageCount"`
}

type SessionListResult struct {
	Sessions []SessionRow `json:"sessions"`
	Cursor   string       `json:"cursor,omitempty"`
}

type SessionCreateParams struct {
	Title string `json:"title,omitempty"`
}

type SessionCreateResult struct {
	ID string `json:"id"`
}

type SessionDeleteParams struct {
	ID string `json:"id"`
}

type SessionDeleteResult struct {
	OK bool `json:"ok"`
}

type SessionMessagesParams struct {
	SessionID string `json:"sessionId"`
	Limit     int    `json:"limit,omitempty"`
	Cursor    string `json:"cursor,omitempty"`
}

type MessageRow struct {
	ID        int    `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type SessionMessagesResult struct {
	Messages []MessageRow `json:"messages"`
	Cursor   string       `json:"cursor,omitempty"`
}
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add Go protocol types for session operations`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Go root model with screen navigation

**Files:**
- Create: `tui/internal/app/app.go`

**Implementation:**

Create `tui/internal/app/app.go` implementing the root bubbletea model:

- Define `ScreenType` as an integer enum: `ScreenSessions`, `ScreenChat`, `ScreenTools`, `ScreenSecrets`, `ScreenSchedules`, `ScreenPrompt`
- Define `AppModel` struct containing:
  - `client *protocol.Client` — JSON-RPC connection
  - `activeScreen ScreenType`
  - `screenStack []ScreenType` — navigation history
  - `sessions *SessionsModel` — sessions screen model (will be created in Task 5)
  - `width, height int` — terminal dimensions
- Implement `Init() tea.Cmd` — returns a command to fetch initial session list
- Implement `Update(msg tea.Msg) (tea.Model, tea.Cmd)`:
  - Handle `tea.WindowSizeMsg` to track dimensions
  - Handle global keybindings (check active screen is NOT chat before intercepting single-key bindings):
    - `ctrl+t` → push ScreenTools
    - `ctrl+s` → push ScreenSecrets
    - `ctrl+d` → push ScreenSchedules
    - `ctrl+p` → push ScreenPrompt
    - `Escape` → pop screen stack (if stack length > 1)
    - `ctrl+c` → `tea.Quit`
  - Delegate to active screen's Update
- Implement `View() tea.View`:
  - Delegate to active screen's View based on `activeScreen`
  - For screens not yet implemented (tools, secrets, schedules, prompt), show placeholder text

Helper methods:
- `pushScreen(s ScreenType)` — append to stack, set activeScreen
- `popScreen()` — pop from stack if length > 1, set activeScreen to new top

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles (some types may be forward-declared or stubbed).

**Commit:** `feat(tui): add root model with screen navigation`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Go sessions screen

**Files:**
- Create: `tui/internal/screens/sessions.go`

**Implementation:**

Create `tui/internal/screens/sessions.go` implementing the sessions screen using the bubbles list component:

- Define a `sessionItem` type implementing `list.DefaultItem` interface:
  - `Title()` returns session title (or "Untitled session" if nil)
  - `Description()` returns message count and last updated info
  - `FilterValue()` returns title for search/filter

- Define `SessionsModel` struct containing:
  - `list list.Model` — the bubbles list component
  - `client *protocol.Client` — for JSON-RPC calls
  - `width, height int`

- Implement `Init() tea.Cmd` — returns command to call `session/list` via JSON-RPC
- Implement `Update(msg tea.Msg)`:
  - Handle `tea.WindowSizeMsg` — resize list
  - Handle custom messages:
    - `sessionsLoadedMsg` — populate list items from JSON-RPC response
    - `sessionCreatedMsg` — refresh list
    - `sessionDeletedMsg` — refresh list
  - Handle keybindings:
    - `Enter` → return command to navigate to chat with selected session ID (via custom message to root model)
    - `n` → call `session/create` via JSON-RPC
    - `d` → call `session/delete` for selected session
  - Delegate remaining keys to list.Model.Update
- Implement `View() tea.View` — render the list

Define custom message types for async JSON-RPC results:
- `sessionsLoadedMsg { sessions []protocol.SessionRow }`
- `sessionCreatedMsg { id string }`
- `sessionDeletedMsg {}`
- `sessionsErrorMsg { err error }`

Define command functions that call the JSON-RPC client and return the appropriate message type.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add sessions screen with list navigation`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update Go entry point to use root model

**Files:**
- Modify: `tui/cmd/constellation-tui/main.go` — replace simple ready-and-exit with full TUI

**Implementation:**

Replace the current entry point that just waits for ready and exits with:

1. Spawn backend and create protocol client (keep existing code)
2. After receiving `ready` notification, create the `AppModel` with the client
3. Create and run `tea.NewProgram(appModel)` with alt screen enabled
4. On program exit, send SIGTERM to backend, wait with timeout

```go
ready, err := client.WaitReady(ctx)
// ... error handling ...

appModel := app.NewAppModel(client)
p := tea.NewProgram(appModel)

result, err := p.Run()
// ... cleanup ...

// Send SIGTERM to backend
backendCmd.Process.Signal(syscall.SIGTERM)

// Wait with timeout
done := make(chan error, 1)
go func() { done <- backendCmd.Wait() }()
select {
case <-done:
case <-time.After(5 * time.Second):
    backendCmd.Process.Kill()
}
```

**Verification:**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && echo "Binary built"
rm -f constellation-tui
```

Expected: Compiles without errors.

**Commit:** `feat(tui): wire root model into entry point`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: End-to-end verification — sessions screen loads

**Step 1: Build and run**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && ./constellation-tui
```

Expected: TUI launches, shows sessions screen (empty list if no sessions exist), ctrl+c quits cleanly.

**Step 2: Verify session operations**

In the TUI:
- Press `n` to create a new session — list should refresh with new entry
- Select session and press `d` to delete — list should refresh
- Press `ctrl+c` to quit

**Step 3: Clean up**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_7 -->
