# GH13: Multi-Screen TUI — Phase 4: Tools Screen

**Goal:** Build the tools screen that manages custom tools (#10), built-in tools, and skill grants (absorbing `ReviewPage.tsx` functionality).

**Architecture:** The tools screen is divided into three sections: custom tools (from `CustomToolManager`), built-in tools (from the `ToolRegistry`), and skills (grant management from the existing `ReviewPage` logic). The screen uses a tabbed or sectioned layout with `j`/`k` navigation within each section.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 4 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC4: Tools screen lists custom tools with approve/revoke actions
- **GH13.AC4.1:** Custom tools section lists tools with name, description, and approval status
- **GH13.AC4.2:** Pressing `a` approves the selected custom tool
- **GH13.AC4.3:** Pressing `r` revokes the selected custom tool
- **GH13.AC4.4:** When `customTools` dependency is undefined, shows "Custom tools not available"

### GH13.AC5: Tools screen lists built-in tools (read-only)
- **GH13.AC5.1:** Built-in tools section lists tool names and descriptions from the registry
- **GH13.AC5.2:** Built-in tools are not interactive (no approve/revoke)

### GH13.AC6: Tools screen handles skill grant management (existing ReviewPage functionality preserved)
- **GH13.AC6.1:** Skills section lists `skill:*` documents with grant status
- **GH13.AC6.2:** `g` grants the selected skill, `r` revokes it
- **GH13.AC6.3:** `v` views skill code
- **GH13.AC6.4:** `s` opens secret assignment for a skill (toggle which vault secrets the skill can access)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tui/screens/ToolsScreen.tsx`

**Verifies:** GH13.AC4.1, GH13.AC4.2, GH13.AC4.3, GH13.AC4.4, GH13.AC5.1, GH13.AC5.2, GH13.AC6.1, GH13.AC6.2, GH13.AC6.3, GH13.AC6.4

**Files:**
- Create: `src/tui/screens/ToolsScreen.tsx`

**Implementation:**

The tools screen has three sections displayed vertically, with a section selector and an item selector within each section.

**Props:**

```typescript
type ToolsScreenProps = {
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly customTools?: TuiDependencies['customTools'];
  readonly builtinTools: ReadonlyArray<{ name: string; description: string }>;
  readonly onBack: () => void;
};
```

Note: `builtinTools` is a pre-built list passed from `App.tsx`. The app shell creates the tool registry once and extracts the tool list. This avoids the tools screen needing direct access to `AgentDependencies`.

**State:**

```typescript
type Section = 'custom' | 'builtin' | 'skills';
type Mode = 'list' | 'view_code' | 'edit_secrets';

const [section, setSection] = useState<Section>('custom');
const [mode, setMode] = useState<Mode>('list');
const [selectedIdx, setSelectedIdx] = useState(0);
// ... plus skill-specific state from ReviewPage (editSecretSkill, editSecretChecked, etc.)
```

**Section navigation:**
- `Tab` cycles through sections: custom → builtin → skills → custom
- `Shift+Tab` cycles backwards

**Within each section:**

**Custom tools section:**
- Lists tools from `customTools?.listTools() ?? []`
- Shows name, description, approval status icon (checkmark/pending/revoked)
- `a` = approve selected (`customTools.approveTool(name)`)
- `r` = revoke selected (`customTools.revokeTool(name)`)
- `Enter` = view tool detail (could show a sub-view with code/parameters/secrets)
- If `customTools` is undefined, show `(Custom tools not available — feature #10 not enabled)`

**Built-in tools section:**
- Lists tools from `builtinTools` prop
- Shows name and first line of description
- Read-only — no actions

**Skills section:**
- Port the existing `ReviewPage` list mode logic:
  - Load `skill:*` documents from `store.docList(500)`
  - Match with grant status from `store.getGrant(rkey)`
  - Parse descriptions from `// Description:` header comments
  - `g` = grant, `r` = revoke, `v` = view code, `s` = edit secret assignments, `d` = delete
- Port the `view_code` and `edit_secrets` sub-modes from `ReviewPage`
- The `add_secret` and `manage_vault` modes from ReviewPage are NOT ported here — secret management moves to the dedicated Secrets screen (Phase 5)

**Layout:**

```
┌─ Tools ──────────────────────────────────────────┐
│ [Custom Tools] [Built-in Tools] [Skills]         │
│ ─────────────────────────────────────────────────│
│ > ✅ my-custom-tool — Does something useful      │
│   ⏳ another-tool — Pending approval             │
│                                                  │
│ Tab=section  a=approve r=revoke Enter=detail     │
│ Esc=back                                         │
└──────────────────────────────────────────────────┘
```

The section tabs at the top are rendered with highlighting on the active section. Inactive sections are dimmed.

**Helper function** for parsing skill descriptions (ported from `ReviewPage.tsx`):

```typescript
function parseDescription(content: string): string {
  const lines = content.split('\n').slice(0, 10);
  for (const line of lines) {
    const match = line.match(/^\/\/\s*Description:\s*(.+)/i);
    if (match) return match[1]!.trim();
  }
  return '';
}
```

Pattern comment: `// pattern: UI Shell — unified tools, built-in tools, and skill management`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add ToolsScreen with custom tools, built-ins, and skill grants`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire ToolsScreen into App.tsx

**Files:**
- Modify: `src/tui/App.tsx` — replace tools placeholder, pass builtinTools prop

**Implementation:**

The tools screen needs a list of built-in tools. Generate this list once in `App.tsx` using a `useMemo`:

```typescript
import { createAgentTools } from '../agent/tools.ts';

// Inside App component:
const builtinToolList = useMemo(() => {
  const registry = createAgentTools(/* ... */);
  return registry.list().map(t => ({
    name: t.name,
    description: t.definition.description.split('\n')[0] ?? '',
  }));
}, []);
```

However, `createAgentTools` requires `AgentDependencies` and a `ChatContext`, which the shell doesn't have directly. A simpler approach: pass the built-in tool names as a static list. The tool registry's `list()` returns the 8 built-in tools, but the registry is created fresh per `agent.chat()` call — it's not accessible from the TUI shell.

Better approach: Add a `getToolList` method to the `Agent` type, or simply hardcode the built-in tool names since they're static and well-known. Even better: add a `builtinTools` field to `TuiDependencies`:

In `src/tui/types.ts`, add:
```typescript
readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
```

In `src/index.ts`, after creating the TUI agent, generate the tool list:
```typescript
const tuiRegistry = createAgentTools(agentDeps, {});
const builtinTools = tuiRegistry.list().map(t => ({
  name: t.name,
  description: t.definition.description.split('\n')[0] ?? '',
}));

startTUI({
  agent: tuiAgent,
  modelName,
  store,
  secrets,
  scheduler,
  builtinTools,
});
```

Then in `App.tsx`:
```typescript
case 'tools':
  return (
    <ToolsScreen
      store={deps.store}
      secrets={deps.secrets}
      customTools={deps.customTools}
      builtinTools={deps.builtinTools ?? []}
      onBack={pop}
    />
  );
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire ToolsScreen into navigation shell`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify skill grant management works end-to-end

**Files:** No new files — this is a verification step

**Implementation:**

The skill grant management from `ReviewPage` has been ported into the skills section of `ToolsScreen`. Verify the following behaviours are preserved:

1. Skills list: `store.docList(500)` filtered to `skill:*` documents, matched with `store.getGrant(rkey)` for status
2. Grant: `store.updateGrantStatus(rkey, 'granted')` — same call as ReviewPage
3. Revoke: `store.updateGrantStatus(rkey, 'revoked')` — same call as ReviewPage
4. View code: Shows first 30 lines of skill content
5. Edit secrets: Toggle which vault secrets are assigned to a skill via `store.updateGrantSecrets()`
6. Delete: `store.docDelete(rkey)` and `store.deleteGrant(rkey)`

Cross-reference the `ToolsScreen` implementation against `ReviewPage.tsx` to ensure no functionality was dropped. The only intentional removals are:
- `add_secret` mode (moved to Secrets screen)
- `manage_vault` mode (moved to Secrets screen)

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && grep -rn "ReviewPage" src/`
Expected: No output (confirming ReviewPage is fully removed)

**Commit:** Not needed — verification only

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
