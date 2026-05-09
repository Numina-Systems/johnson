# Bubbletea TUI Implementation Plan — Phase 4: Tools & Skills Management

**Goal:** Implement the tools screen with tabbed navigation for skills, custom tools, and builtins, plus all corresponding TS JSON-RPC handlers.

**Architecture:** Go tools screen uses three independent `list.Model` instances (one per tab), with lipgloss-styled tab headers. Tab/Shift+Tab switches active tab, routing Update to the active list. TS handlers delegate to existing Store grant methods, CustomToolManager, and ToolRegistry. Skills are fetched via `docList` + prefix filter (no `docListByPrefix` exists — matching existing pattern). Sub-modes for viewing code and editing secrets.

**Tech Stack:** Go 1.26, bubbletea v2, bubbles v2 (list), lipgloss v2, TypeScript/Bun

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.2 Success:** All request methods return well-formed JSON-RPC responses with correct data (Note: design says 20, actual count is 21 with the addition of `builtin/list`)

### bubbletea-tui.AC2: Go TUI implements all screens with hybrid layout
- **bubbletea-tui.AC2.6 Success:** Tools screen shows skills, custom tools, and builtins in tabbed view with grant/revoke/secret assignment

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.1 Success:** JSON-RPC server translates requests to existing Store/Agent/SecretManager/Scheduler/CustomToolManager calls without modifying business logic

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: TS protocol types for tools, skills, and grants

**Files:**
- Modify: `src/jsonrpc/types.ts` — add all tool/skill/grant request/response types

**Implementation:**

Add to `src/jsonrpc/types.ts`:

```typescript
// Skills
export type SkillInfo = {
  readonly rkey: string;
  readonly description: string | null;
  readonly grantStatus: 'pending' | 'granted' | 'revoked' | null;
  readonly secrets: ReadonlyArray<string>;
};

export type SkillListResult = {
  readonly skills: ReadonlyArray<SkillInfo>;
};

export type SkillGrantParams = {
  readonly rkey: string;
  readonly status: 'granted' | 'revoked';
};

export type SkillUpdateSecretsParams = {
  readonly rkey: string;
  readonly secrets: ReadonlyArray<string>;
};

export type SkillDeleteParams = {
  readonly rkey: string;
};

// Custom Tools
export type CustomToolInfo = {
  readonly name: string;
  readonly description: string;
  readonly approved: boolean;
  readonly codeHash: string;
  readonly secrets: ReadonlyArray<string>;
};

export type CustomToolListResult = {
  readonly tools: ReadonlyArray<CustomToolInfo>;
};

export type CustomToolApproveParams = {
  readonly name: string;
};

export type CustomToolRevokeParams = {
  readonly name: string;
};

export type CustomToolUpdateSecretsParams = {
  readonly name: string;
  readonly secrets: ReadonlyArray<string>;
};

// Grants
export type GrantInfo = {
  readonly skillName: string;
  readonly codeHash: string;
  readonly status: string;
  readonly secrets: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type GrantListResult = {
  readonly grants: ReadonlyArray<GrantInfo>;
};

// Simple ok response (reusable)
export type OkResult = {
  readonly ok: boolean;
};

// Builtins
export type BuiltinToolInfo = {
  readonly name: string;
  readonly description: string;
};

export type BuiltinListResult = {
  readonly tools: ReadonlyArray<BuiltinToolInfo>;
};
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(jsonrpc): add protocol types for tools, skills, and grants`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: TS handlers for skill, customTool, and grant operations

**Verifies:** bubbletea-tui.AC1.2, bubbletea-tui.AC3.1

**Files:**
- Modify: `src/jsonrpc/handlers.ts` — add 10 handlers, update `JsonRpcDependencies`
- Modify: `src/index.ts` — pass `customTools`, `store`, and `builtinTools` into dependencies

**Implementation:**

Update `JsonRpcDependencies` to include:
- `store` (already added in Phase 2)
- `customTools: CustomToolManager` (from `src/tools/custom-tool-manager.ts`)

The `builtinTools` list is static for the session lifetime, so pass it as a field too:
- `builtinTools: ReadonlyArray<{ name: string; description: string }>`

Register 9 handlers:

**`skill/list`:**
- Call `store.docList(500)` to get all documents
- Filter to `rkey.startsWith('skill:')`
- For each skill doc, call `store.getGrant(doc.rkey)` to get grant status and secrets
- Parse description from `// Description: ...` header comment (first line starting with `// Description:`)
- Return `{ skills: [...] }`

**`skill/grant`:**
- Call `store.updateGrantStatus(params.rkey, params.status)`
- Return `{ ok: true }`

**`skill/updateSecrets`:**
- Call `store.updateGrantSecrets(params.rkey, params.secrets)`
- Return `{ ok: true }`

**`skill/delete`:**
- Call `store.docDelete(params.rkey)` AND `store.deleteGrant(params.rkey)` (both required)
- Return `{ ok: true }`

**`customTool/list`:**
- Call `customTools.listTools()`
- Map to `CustomToolInfo` shape
- Return `{ tools: [...] }`

**`customTool/approve`:**
- Call `customTools.approveTool(params.name)`
- Return `{ ok: result }`

**`customTool/revoke`:**
- Call `customTools.revokeTool(params.name)`
- Return `{ ok: result }`

**`customTool/updateSecrets`:**
- Call `customTools.updateSecrets(params.name, params.secrets)`
- Return `{ ok: result }`

**`grant/list`:**
- Call `store.listGrants()`
- Return `{ grants: [...] }`

**`builtin/list`:**
- Return `{ tools: builtinTools }` — this is the static array passed via `JsonRpcDependencies`
- No backend call needed, just return the pre-computed list

Update `src/index.ts` to pass `customTools` and `builtinTools` into `JsonRpcDependencies`.

**Testing:**

Tests must verify:
- bubbletea-tui.AC1.2: Each handler returns well-formed response
- bubbletea-tui.AC3.1: skill/list correctly filters documents by prefix and enriches with grant data
- bubbletea-tui.AC3.1: skill/delete calls both docDelete and deleteGrant
- bubbletea-tui.AC3.1: customTool handlers correctly delegate to CustomToolManager

Create or extend `src/jsonrpc/handlers.test.ts`. Mock Store with docList, getGrant, updateGrantStatus, etc. Mock CustomToolManager.

**Verification:**

```bash
bun test src/jsonrpc/
```

Expected: All tests pass.

**Commit:** `feat(jsonrpc): add handlers for skills, custom tools, and grants`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Go protocol types for tools, skills, and grants

**Files:**
- Modify: `tui/internal/protocol/types.go` — add all tool/skill/grant types

**Implementation:**

Add to `tui/internal/protocol/types.go`:

```go
// Skills
type SkillInfo struct {
	Rkey        string   `json:"rkey"`
	Description *string  `json:"description"`
	GrantStatus *string  `json:"grantStatus"`
	Secrets     []string `json:"secrets"`
}

type SkillListResult struct {
	Skills []SkillInfo `json:"skills"`
}

type SkillGrantParams struct {
	Rkey   string `json:"rkey"`
	Status string `json:"status"`
}

type SkillUpdateSecretsParams struct {
	Rkey    string   `json:"rkey"`
	Secrets []string `json:"secrets"`
}

type SkillDeleteParams struct {
	Rkey string `json:"rkey"`
}

// Custom Tools
type CustomToolInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Approved    bool     `json:"approved"`
	CodeHash    string   `json:"codeHash"`
	Secrets     []string `json:"secrets"`
}

type CustomToolListResult struct {
	Tools []CustomToolInfo `json:"tools"`
}

type CustomToolApproveParams struct {
	Name string `json:"name"`
}

type CustomToolRevokeParams struct {
	Name string `json:"name"`
}

type CustomToolUpdateSecretsParams struct {
	Name    string   `json:"name"`
	Secrets []string `json:"secrets"`
}

// Grants
type GrantInfo struct {
	SkillName string   `json:"skillName"`
	CodeHash  string   `json:"codeHash"`
	Status    string   `json:"status"`
	Secrets   []string `json:"secrets"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type GrantListResult struct {
	Grants []GrantInfo `json:"grants"`
}

// Generic OK response
type OkResult struct {
	OK bool `json:"ok"`
}

// Builtins
type BuiltinToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type BuiltinListResult struct {
	Tools []BuiltinToolInfo `json:"tools"`
}
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add Go protocol types for tools and grants`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Go protocol client — add tool/skill/grant methods

**Files:**
- Modify: `tui/internal/protocol/client.go` — add convenience methods for all 9 tool endpoints

**Implementation:**

Add methods to Client:

```go
func (c *Client) ListSkills(ctx context.Context) (SkillListResult, error)
func (c *Client) GrantSkill(ctx context.Context, rkey string, status string) (OkResult, error)
func (c *Client) UpdateSkillSecrets(ctx context.Context, rkey string, secrets []string) (OkResult, error)
func (c *Client) DeleteSkill(ctx context.Context, rkey string) (OkResult, error)
func (c *Client) ListCustomTools(ctx context.Context) (CustomToolListResult, error)
func (c *Client) ApproveCustomTool(ctx context.Context, name string) (OkResult, error)
func (c *Client) RevokeCustomTool(ctx context.Context, name string) (OkResult, error)
func (c *Client) UpdateCustomToolSecrets(ctx context.Context, name string, secrets []string) (OkResult, error)
func (c *Client) ListGrants(ctx context.Context) (GrantListResult, error)
func (c *Client) ListBuiltins(ctx context.Context) (BuiltinListResult, error)
```

Each method follows the same pattern as the existing `Chat` method: call `c.Call(ctx, method, params, &result)`.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add protocol client methods for tools and grants`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Go tools screen with tabbed navigation

**Files:**
- Create: `tui/internal/screens/tools.go`

**Implementation:**

Create `tui/internal/screens/tools.go`:

Define `ToolsModel` struct:
```go
type ToolsModel struct {
	client     *protocol.Client
	tabs       []string        // ["Skills", "Custom Tools", "Builtins"]
	activeTab  int
	skillList  list.Model
	customList list.Model
	builtinList list.Model
	mode       toolsMode       // list | viewCode | editSecrets
	codeViewer viewport.Model  // for view_code sub-mode
	// for edit_secrets sub-mode:
	secretNames    []string
	secretSelected []bool
	secretCursor   int
	editTarget     string      // rkey or tool name being edited
	editIsSkill    bool        // true = skill, false = custom tool
	width, height  int
}

type toolsMode int
const (
	toolsModeList toolsMode = iota
	toolsModeViewCode
	toolsModeEditSecrets
)
```

Define custom item types implementing `list.DefaultItem`:
- `skillItem` — shows rkey (without `skill:` prefix), description, grant status badge
- `customToolItem` — shows name, description, approved/unapproved badge
- `builtinItem` — shows name, description (read-only)

**Init():** Return command to fetch skills, custom tools, and grants in parallel via `tea.Batch`.

**Update():**
- `toolsModeList`:
  - `Tab` → cycle to next tab: `(activeTab + 1) % 3`
  - `Shift+Tab` → cycle to previous tab: `(activeTab + 2) % 3`
  - Skills tab actions:
    - `g` → call `client.GrantSkill(rkey, "granted")`, refresh
    - `r` → call `client.GrantSkill(rkey, "revoked")`, refresh
    - `v` → enter viewCode mode with skill content
    - `s` → enter editSecrets mode for selected skill
    - `d` → call `client.DeleteSkill(rkey)`, refresh
  - Custom tools tab actions:
    - `a` → call `client.ApproveCustomTool(name)`, refresh
    - `r` → call `client.RevokeCustomTool(name)`, refresh
    - `v` → enter viewCode mode
    - `s` → enter editSecrets mode
  - Builtins tab: no actions (read-only list)
  - `Escape` → return navigation message to root model
  - All other keys → delegate to active list

- `toolsModeViewCode`:
  - Delegate scrolling keys to viewport
  - `Escape` → return to list mode

- `toolsModeEditSecrets`:
  - `j/k` or arrows → move cursor
  - `Space` or `Enter` → toggle selected secret
  - `Escape` → save selected secrets (call `client.UpdateSkillSecrets` or `client.UpdateCustomToolSecrets`), return to list mode

**View():**
- `toolsModeList`: Render tab headers (active tab highlighted via lipgloss) + active list
- `toolsModeViewCode`: Render viewport with code content, help text at bottom
- `toolsModeEditSecrets`: Render checkbox list of secrets

Wire into root model `app.go`: add `tools *screens.ToolsModel` field, route when `activeScreen == ScreenTools`.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add tools screen with tabbed navigation`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: End-to-end verification — tools screen

**Step 1: Build and run**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && ./constellation-tui
```

**Step 2: Verify tools screen**

1. Press `ctrl+t` to navigate to tools screen
2. Verify three tabs visible: Skills, Custom Tools, Builtins
3. Press `Tab` / `Shift+Tab` to switch between tabs
4. On Skills tab: verify skill list with grant status badges
5. On Custom Tools tab: verify tool list with approved/unapproved badges
6. On Builtins tab: verify read-only list of builtin tools
7. Test grant/revoke on a skill (press `g` then `r`)
8. Test view code (press `v`, scroll with j/k, press `Escape`)
9. Test edit secrets (press `s`, toggle with Space, press `Escape`)
10. Press `Escape` to return to previous screen

**Step 3: Clean up**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_6 -->
