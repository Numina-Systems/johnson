# Bubbletea TUI Implementation Plan — Phase 5: Secrets, Schedules & System Prompt

**Goal:** Implement the remaining three management screens with their TS JSON-RPC handlers.

**Architecture:** Three straightforward screens: secrets (list + add/remove), schedules (list + enable/disable), system prompt (read-only viewport). TS handlers delegate to existing SecretManager, TaskStore (scheduler), and buildSystemPrompt() (pure function from src/agent/prompt.ts). The prompt handler constructs SystemPromptParams from store/config/secrets without needing agent state.

**Tech Stack:** Go 1.26, bubbletea v2, bubbles v2 (list, viewport, textarea), lipgloss v2, TypeScript/Bun

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.2 Success:** All 20 request methods return well-formed JSON-RPC responses with correct data

### bubbletea-tui.AC2: Go TUI implements all screens with hybrid layout
- **bubbletea-tui.AC2.7 Success:** Secrets screen lists secret names (never values), supports add/remove
- **bubbletea-tui.AC2.8 Success:** Schedules screen lists tasks with run counts and last-run info, supports enable/disable
- **bubbletea-tui.AC2.9 Success:** Prompt screen shows current system prompt in a scrollable viewport

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.1 Success:** JSON-RPC server translates requests to existing Store/Agent/SecretManager/Scheduler/CustomToolManager calls without modifying business logic

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: TS protocol types for secrets, schedules, and prompt

**Files:**
- Modify: `src/jsonrpc/types.ts` — add request/response types

**Implementation:**

Add to `src/jsonrpc/types.ts`:

```typescript
// Secrets
export type SecretListResult = {
  readonly keys: ReadonlyArray<string>;
};

export type SecretSetParams = {
  readonly key: string;
  readonly value: string;
};

export type SecretRemoveParams = {
  readonly key: string;
};

// Schedules
export type TaskRunInfo = {
  readonly taskId: string;
  readonly startedAt: string;
  readonly output: string;
  readonly success: boolean;
  readonly durationMs: number;
};

export type TaskStateInfo = {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly deliverTo?: string;
  readonly trigger?: string;
  readonly skill?: string;
  readonly createdAt: string;
  readonly enabled: boolean;
  readonly lastRun?: TaskRunInfo;
  readonly runCount: number;
};

export type ScheduleListResult = {
  readonly tasks: ReadonlyArray<TaskStateInfo>;
};

export type ScheduleSetEnabledParams = {
  readonly id: string;
  readonly enabled: boolean;
};

// Prompt
export type PromptGetResult = {
  readonly prompt: string;
};
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(jsonrpc): add protocol types for secrets, schedules, and prompt`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: TS handlers for secrets, schedules, and prompt

**Verifies:** bubbletea-tui.AC1.2, bubbletea-tui.AC3.1

**Files:**
- Modify: `src/jsonrpc/handlers.ts` — add 6 handlers, update `JsonRpcDependencies`
- Modify: `src/index.ts` — pass `secrets`, `scheduler`, config values into dependencies

**Implementation:**

Update `JsonRpcDependencies` to include:
- `secrets: SecretManager` (from `src/secrets/manager.ts`)
- `scheduler: TaskStore` (from `src/scheduler/types.ts`)
- `buildPrompt: () => string` — a closure that builds the current system prompt

For `buildPrompt`, create the closure in `src/index.ts` when wiring up jsonrpc mode. **Important:** The jsonrpc mode block must create its own `ToolRegistry` — the `tuiRegistry` variable is scoped to the `tui` mode block and is not available here. Create the registry at the top of the jsonrpc block:

```typescript
// Inside the jsonrpc mode block, before creating handlers:
const jsonrpcRegistry = createAgentTools({ ...agentDeps, scheduler }, {});
const toolDocs = jsonrpcRegistry.generateToolDocumentation();
const builtinTools = jsonrpcRegistry.list().map(t => ({
  name: t.name,
  description: t.definition.description.split('\n')[0] ?? '',
}));
const nativeToolDefs = jsonrpcRegistry.generateToolDefinitions();

const buildPrompt = (): string => {
  const selfDoc = store.docGet('self')?.content?.trim() ?? '';
  const allDocs = store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  const secretNames = secrets?.listKeys() ?? [];
  const customToolSummaries = customTools?.getApprovedToolSummaries() ?? [];
  const nativeToolNames = nativeToolDefs.map(t => t.name);
  return buildSystemPrompt({
    selfDoc,
    skillNames,
    toolDocs,
    timezone: config.agent?.timezone,
    secretNames,
    customToolSummaries,
    nativeToolNames,
  });
};
```

Register 6 handlers:

**`secret/list`:**
- Call `secrets.listKeys()`
- Return `{ keys: [...] }`

**`secret/set`:**
- Call `await secrets.set(params.key, params.value)`
- Return `{ ok: true }`

**`secret/remove`:**
- Call `await secrets.remove(params.key)`
- Return `{ ok: true }`

**`schedule/list`:**
- Call `scheduler.list()`
- Return `{ tasks: [...] }` — map TaskState directly (shape already matches)

**`schedule/setEnabled`:**
- Call `scheduler.setEnabled(params.id, params.enabled)`
- Return `{ ok: result }`

**`prompt/get`:**
- Call `buildPrompt()`
- Return `{ prompt: result }`

Update `src/index.ts` to pass `secrets`, `scheduler`, `builtinTools`, and the `buildPrompt` closure into `JsonRpcDependencies`. The jsonrpc mode block creates its own `jsonrpcRegistry` (see closure code above) — `store`, `secrets`, `customTools`, and `config` are available from the outer `main()` scope.

**Testing:**

Tests must verify:
- bubbletea-tui.AC1.2: Each handler returns well-formed response
- bubbletea-tui.AC3.1: secret/list returns keys from SecretManager
- bubbletea-tui.AC3.1: secret/set calls SecretManager.set (async)
- bubbletea-tui.AC3.1: schedule/list returns task states
- bubbletea-tui.AC3.1: schedule/setEnabled delegates to scheduler
- bubbletea-tui.AC3.1: prompt/get calls buildPrompt closure

Create or extend `src/jsonrpc/handlers.test.ts`. Mock SecretManager, TaskStore, and buildPrompt closure.

**Verification:**

```bash
bun test src/jsonrpc/
```

Expected: All tests pass.

**Commit:** `feat(jsonrpc): add handlers for secrets, schedules, and prompt`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-6) -->
<!-- START_TASK_3 -->
### Task 3: Go protocol types and client methods for secrets, schedules, and prompt

**Files:**
- Modify: `tui/internal/protocol/types.go` — add types
- Modify: `tui/internal/protocol/client.go` — add client methods

**Implementation:**

Add to `tui/internal/protocol/types.go`:

```go
// Secrets
type SecretListResult struct {
	Keys []string `json:"keys"`
}

type SecretSetParams struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type SecretRemoveParams struct {
	Key string `json:"key"`
}

// Schedules
type TaskRunInfo struct {
	TaskID     string `json:"taskId"`
	StartedAt  string `json:"startedAt"`
	Output     string `json:"output"`
	Success    bool   `json:"success"`
	DurationMs int    `json:"durationMs"`
}

type TaskStateInfo struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Prompt    string       `json:"prompt"`
	Schedule  string       `json:"schedule"`
	DeliverTo string       `json:"deliverTo,omitempty"`
	Trigger   string       `json:"trigger,omitempty"`
	Skill     string       `json:"skill,omitempty"`
	CreatedAt string       `json:"createdAt"`
	Enabled   bool         `json:"enabled"`
	LastRun   *TaskRunInfo `json:"lastRun,omitempty"`
	RunCount  int          `json:"runCount"`
}

type ScheduleListResult struct {
	Tasks []TaskStateInfo `json:"tasks"`
}

type ScheduleSetEnabledParams struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// Prompt
type PromptGetResult struct {
	Prompt string `json:"prompt"`
}
```

Add client methods:

```go
func (c *Client) ListSecrets(ctx context.Context) (SecretListResult, error)
func (c *Client) SetSecret(ctx context.Context, key string, value string) (OkResult, error)
func (c *Client) RemoveSecret(ctx context.Context, key string) (OkResult, error)
func (c *Client) ListSchedules(ctx context.Context) (ScheduleListResult, error)
func (c *Client) SetScheduleEnabled(ctx context.Context, id string, enabled bool) (OkResult, error)
func (c *Client) GetPrompt(ctx context.Context) (PromptGetResult, error)
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add Go protocol types and client methods for secrets, schedules, prompt`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Go secrets screen

**Files:**
- Create: `tui/internal/screens/secrets.go`

**Implementation:**

Create `tui/internal/screens/secrets.go`:

Define `SecretsModel` struct:
```go
type SecretsModel struct {
	client       *protocol.Client
	keys         []string
	cursor       int
	mode         secretsMode  // list | addName | addValue
	nameInput    textinput.Model  // for add flow: name entry
	valueInput   textinput.Model  // for add flow: value entry (masked)
	width, height int
}

type secretsMode int
const (
	secretsModeList secretsMode = iota
	secretsModeAddName
	secretsModeAddValue
)
```

Note: Use `charm.land/bubbles/v2/textinput` (single-line text input) for the add flow, not textarea. For the value input, set `EchoMode = textinput.EchoPassword` so the value is masked.

**Init():** Return command to fetch secret keys via `client.ListSecrets()`.

**Update():**
- `secretsModeList`:
  - `j/k` or arrows → move cursor
  - `a` or `n` → enter addName mode, focus nameInput
  - `d` → call `client.RemoveSecret(selectedKey)`, refresh list
  - `Escape` → return navigation message to root model
- `secretsModeAddName`:
  - `Enter` → if name is not empty, switch to addValue mode, focus valueInput
  - `Escape` → return to list mode
  - Delegate to nameInput
- `secretsModeAddValue`:
  - `Enter` → if value is not empty, call `client.SetSecret(name, value)`, clear inputs, return to list mode, refresh
  - `Escape` → return to list mode
  - Delegate to valueInput

**View():**
- `secretsModeList`: Render list of secret names with cursor indicator, help text at bottom showing keybindings
- `secretsModeAddName`: Render "Add secret — Name:" prompt with nameInput
- `secretsModeAddValue`: Render "Add secret — Value:" prompt with valueInput (masked)

Wire into root model: add `secrets *screens.SecretsModel`, route when `activeScreen == ScreenSecrets`.

Add `go get charm.land/bubbles/v2` to get the textinput component (should already be available from the list dependency).

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add secrets screen with add/remove`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Go schedules screen

**Files:**
- Create: `tui/internal/screens/schedules.go`

**Implementation:**

Create `tui/internal/screens/schedules.go`:

Define `SchedulesModel` struct:
```go
type SchedulesModel struct {
	client       *protocol.Client
	tasks        []protocol.TaskStateInfo
	cursor       int
	width, height int
}
```

**Init():** Return command to fetch task list via `client.ListSchedules()`.

**Update():**
- `j/k` or arrows → move cursor
- `e` → toggle enabled/disabled for selected task: call `client.SetScheduleEnabled(id, !task.Enabled)`, refresh
- `Escape` → return navigation message to root model

**View():**
Render a table-like display for each task:
- Name
- Schedule expression (cron string)
- Enabled/disabled badge
- Run count
- Last run: timestamp + OK/FAIL + duration (e.g., "2026-05-09 14:30 OK 2.3s") or "Never" if no last run

Help text at bottom showing keybindings.

Wire into root model: add `schedules *screens.SchedulesModel`, route when `activeScreen == ScreenSchedules`.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add schedules screen`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Go system prompt screen

**Files:**
- Create: `tui/internal/screens/prompt.go`

**Implementation:**

Create `tui/internal/screens/prompt.go`:

Define `PromptModel` struct:
```go
type PromptModel struct {
	client   *protocol.Client
	viewport viewport.Model
	ready    bool
	width, height int
}
```

**Init():** Return command to fetch system prompt via `client.GetPrompt()`.

**Update():**
- `tea.WindowSizeMsg` → resize viewport
- Custom message with prompt content → set viewport content, mark ready
- `Escape` → return navigation message to root model
- Delegate scrolling keys to viewport (j/k, arrows, PgUp/PgDn, g/G)

**View():**
- If not ready: "Loading system prompt..."
- If ready: render viewport with prompt content

Wire into root model: add `prompt *screens.PromptModel`, route when `activeScreen == ScreenPrompt`.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add system prompt screen`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: End-to-end verification — all three screens

**Step 1: Build and run**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && ./constellation-tui
```

**Step 2: Verify secrets screen**

1. Press `ctrl+s` to navigate to secrets screen
2. Verify secret names listed (no values shown)
3. Press `a` to add — enter name, press Enter, enter value (masked), press Enter
4. Verify new secret appears in list
5. Select a secret, press `d` to delete
6. Press `Escape` to return

**Step 3: Verify schedules screen**

1. Press `ctrl+d` to navigate to schedules screen
2. Verify tasks listed with schedule, run count, last run info
3. Select a task, press `e` to toggle enabled/disabled
4. Press `Escape` to return

**Step 4: Verify system prompt screen**

1. Press `ctrl+p` to navigate to prompt screen
2. Verify system prompt is displayed in scrollable viewport
3. Scroll with j/k, PgUp/PgDn
4. Press `Escape` to return

**Step 5: Clean up**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_7 -->
