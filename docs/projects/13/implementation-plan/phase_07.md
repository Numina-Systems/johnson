# GH13: Multi-Screen TUI — Phase 7: System Prompt Screen and Final Polish

**Goal:** Build the system prompt screen and do a final pass to ensure all screens are wired, navigation is consistent, and the shared utility code is extracted.

**Architecture:** The system prompt screen is read-only and scrollable. It calls the `systemPromptProvider` (from #12) or falls back to calling `buildSystemPrompt()` directly to assemble the current system prompt, then renders it in a scrollable text view. This phase also extracts any shared utilities (e.g., `formatDate`) into `src/tui/util.ts`.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 7 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC9: System prompt screen shows current assembled prompt (scrollable)
- **GH13.AC9.1:** Screen displays the full system prompt text
- **GH13.AC9.2:** Content is scrollable with `j`/`k` or up/down arrows
- **GH13.AC9.3:** `Page Up`/`Page Down` scroll by larger increments
- **GH13.AC9.4:** Screen is read-only — no editing capabilities

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Extract shared TUI utilities to `src/tui/util.ts`

**Files:**
- Create: `src/tui/util.ts`
- Modify: `src/tui/screens/SessionsScreen.tsx` — import `formatDate` from `../util.ts` instead of defining it inline
- Modify: `src/tui/screens/SchedulesScreen.tsx` — import `formatDate` from `../util.ts` instead of defining it inline

**Implementation:**

Extract the `formatDate` helper and any other shared utility functions. Also add a `parseDescription` helper (used by both `ToolsScreen` and potentially the prompt screen):

```typescript
// pattern: Functional Core — shared TUI utility functions

/**
 * Format an ISO timestamp as a relative or short date string.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

/**
 * Parse a description from a skill/tool document's header comment.
 * Looks for `// Description: ...` in the first few lines.
 */
export function parseDescription(content: string): string {
  const lines = content.split('\n').slice(0, 10);
  for (const line of lines) {
    const match = line.match(/^\/\/\s*Description:\s*(.+)/i);
    if (match) return match[1]!.trim();
  }
  return '';
}
```

Update `SessionsScreen.tsx` and `SchedulesScreen.tsx` to import from `'../util.ts'` instead of defining inline. Update `ToolsScreen.tsx` to import `parseDescription` from `'../util.ts'`.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `refactor(tui): extract shared utilities to util.ts`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/tui/screens/SystemPromptScreen.tsx`

**Verifies:** GH13.AC9.1, GH13.AC9.2, GH13.AC9.3, GH13.AC9.4

**Files:**
- Create: `src/tui/screens/SystemPromptScreen.tsx`

**Implementation:**

**Props:**

```typescript
type SystemPromptScreenProps = {
  readonly store: Store;
  readonly personaPath: string;
  readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;
  readonly timezone: string;
  readonly onBack: () => void;
};
```

Wait — the `systemPromptProvider` from the design takes `toolDocs: string`. But the TUI shell doesn't readily have `toolDocs` available. Let's reconsider the approach.

Actually, `systemPromptProvider` from #12 is designed to be called with toolDocs and return the full assembled prompt. The simplest approach for the TUI is to assemble the prompt the same way the agent does:

1. Read persona from `personaPath`
2. Load core memory from store
3. Load skill names from store
4. Generate tool docs from registry (or pass empty string since this is just for display)
5. Call `buildSystemPrompt()`

However, this duplicates logic from `agent.ts`. The cleaner path: accept a `getSystemPrompt` callback that returns the assembled prompt with no arguments.

Revised props:

```typescript
type SystemPromptScreenProps = {
  readonly getSystemPrompt: () => Promise<string>;
  readonly onBack: () => void;
};
```

The parent (`App.tsx`) provides this callback by closing over the dependencies it already has. This keeps the screen simple and decoupled.

**State:**

```typescript
const [prompt, setPrompt] = useState<string>('Loading...');
const [scrollOffset, setScrollOffset] = useState(0);
const [totalLines, setTotalLines] = useState(0);
```

**On mount, fetch the prompt:**

```typescript
useEffect(() => {
  getSystemPrompt().then(text => {
    setPrompt(text);
    setTotalLines(text.split('\n').length);
  }).catch(err => {
    setPrompt(`Error loading system prompt: ${err}`);
  });
}, [getSystemPrompt]);
```

**Scrollable text view:**

Split the prompt into lines and render a window of visible lines based on `scrollOffset`:

```typescript
const lines = prompt.split('\n');
const visibleHeight = 30; // approximate terminal height minus header/footer
const visible = lines.slice(scrollOffset, scrollOffset + visibleHeight);
```

**Key bindings:**
- `j`/down arrow — scroll down one line
- `k`/up arrow — scroll up one line
- `Page Down` (Ink's `key.pageDown`) — scroll down by `visibleHeight`
- `Page Up` (Ink's `key.pageUp`) — scroll up by `visibleHeight`
- `Home` (Ink's `key.home`) — scroll to top
- `End` (Ink's `key.end`) — scroll to bottom
- `Escape` — call `onBack()`

```typescript
useInput((input, key) => {
  if (key.escape) { onBack(); return; }
  const maxOffset = Math.max(0, totalLines - visibleHeight);
  if (input === 'j' || key.downArrow) setScrollOffset(o => Math.min(o + 1, maxOffset));
  if (input === 'k' || key.upArrow) setScrollOffset(o => Math.max(o - 1, 0));
  if (key.pageDown) setScrollOffset(o => Math.min(o + visibleHeight, maxOffset));
  if (key.pageUp) setScrollOffset(o => Math.max(o - visibleHeight, 0));
  if (key.home) setScrollOffset(0);
  if (key.end) setScrollOffset(maxOffset);
});
```

**Layout:**

```
┌─ System Prompt ──────────────────────────────────┐
│ Line 1 of prompt text...                         │
│ Line 2 of prompt text...                         │
│ ...                                              │
│ ─────────────────────────────────────────────────│
│ Lines 1-30 of 142 | j/k=scroll PgUp/PgDn Esc    │
└──────────────────────────────────────────────────┘
```

The footer shows the current line range and total, plus key hints.

For terminal height detection: `useStdout()` from Ink provides `stdout.rows`. Use this instead of a hardcoded `visibleHeight`:

```typescript
import { useStdout } from 'ink';

const { stdout } = useStdout();
const visibleHeight = (stdout?.rows ?? 24) - 6; // reserve for header + footer
```

Pattern comment: `// pattern: UI Shell — read-only scrollable system prompt viewer`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add SystemPromptScreen with scrollable prompt view`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire SystemPromptScreen into App.tsx

**Files:**
- Modify: `src/tui/App.tsx` — replace prompt placeholder with real component
- Modify: `src/tui/types.ts` — add `personaPath` and `timezone` to `TuiDependencies` (needed for prompt assembly)
- Modify: `src/index.ts` — pass `personaPath` and `timezone` to `startTUI`

**Implementation:**

Add to `TuiDependencies` in `src/tui/types.ts`:

```typescript
readonly personaPath: string;
readonly timezone: string;
```

Update `src/index.ts` to pass these:

```typescript
startTUI({
  agent: tuiAgent,
  modelName,
  store,
  secrets,
  scheduler,
  builtinTools,
  personaPath: PERSONA_PATH,
  timezone: config.agent.timezone,
});
```

In `App.tsx`, create the `getSystemPrompt` callback:

```typescript
import { buildSystemPrompt, loadCoreMemoryFromStore } from '../agent/context.ts';

// Inside App component:
const getSystemPrompt = useCallback(async () => {
  if (deps.systemPromptProvider) {
    return deps.systemPromptProvider('');
  }
  // Fallback: assemble prompt the same way the agent does
  const persona = await Bun.file(deps.personaPath).text();
  const coreMemory = loadCoreMemoryFromStore(deps.store);
  const allDocs = deps.store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  return buildSystemPrompt(persona, coreMemory, skillNames, '', deps.timezone);
}, [deps]);
```

Wire the screen:

```typescript
case 'prompt':
  return (
    <SystemPromptScreen
      getSystemPrompt={getSystemPrompt}
      onBack={pop}
    />
  );
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire SystemPromptScreen into navigation shell`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final verification and cleanup

**Files:** Review all modified files for consistency

**Implementation:**

1. Verify the complete file inventory matches the design:
   - `src/tui/types.ts` — new (Phase 1)
   - `src/tui/util.ts` — new (Phase 7)
   - `src/tui/App.tsx` — refactored to navigation shell
   - `src/tui/index.ts` — updated startTUI signature
   - `src/tui/screens/SessionsScreen.tsx` — new (Phase 2)
   - `src/tui/screens/ChatScreen.tsx` — new (Phase 3)
   - `src/tui/screens/ToolsScreen.tsx` — new (Phase 4)
   - `src/tui/screens/SecretsScreen.tsx` — new (Phase 5)
   - `src/tui/screens/SchedulesScreen.tsx` — new (Phase 6)
   - `src/tui/screens/SystemPromptScreen.tsx` — new (Phase 7)
   - `src/tui/ReviewPage.tsx` — deleted (Phase 3)
   - `src/store/store.ts` — added `deleteSession`, `getSessionMessageCount`
   - `src/scheduler/types.ts` — added `setEnabled`
   - `src/scheduler/scheduler.ts` — implemented `setEnabled`
   - `src/index.ts` — expanded TUI wiring

2. Verify all pattern comments are present on new files.

3. Run full type check and build:
   ```bash
   cd /Users/scarndp/dev/johnson/.worktrees/GH13
   npx tsc --noEmit
   bun run build
   ```

4. Verify no references to deleted `ReviewPage`:
   ```bash
   grep -rn "ReviewPage" src/
   ```

5. Verify all screens handle their own `Escape` (or delegate to the shell's global handler).

6. Verify no screen leaks `useInput` handlers when not active (all `useInput` calls that are screen-specific should be inside the screen component, not in the shell).

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit && bun run build`
Expected: Both succeed

**Commit:** `chore(tui): final cleanup and verification for multi-screen TUI`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
