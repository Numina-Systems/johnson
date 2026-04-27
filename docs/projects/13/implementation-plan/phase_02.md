# GH13: Multi-Screen TUI — Phase 2: Sessions Screen

**Goal:** Build the sessions landing screen that lists all sessions, supports creating new ones and deleting existing ones, and navigates into the chat screen.

**Architecture:** The sessions screen reads from `store.listSessions()` and renders a navigable list. Creating a new session generates a UUID, calls `store.createSession()`, and pushes the chat screen. Deleting a session requires adding a `deleteSession` method to the `Store` interface and implementation. The header displays model name and counts for secrets, tools, and schedules.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 2 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC1: Sessions screen lists sessions with titles and dates
- **GH13.AC1.1:** Sessions screen displays session title (or "Untitled" fallback), last updated date, and message count
- **GH13.AC1.2:** Sessions are sorted by most recent first (store already does this via `ORDER BY updated_at DESC`)
- **GH13.AC1.3:** Empty state shows a helpful message when no sessions exist

### GH13.AC2: New session creation works, opens chat screen
- **GH13.AC2.1:** Pressing `n` creates a new session in the store and pushes the chat screen
- **GH13.AC2.2:** The new session receives a UUID and optional default title

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `deleteSession` and `getSessionMessageCount` to the Store

**Files:**
- Modify: `src/store/store.ts` — add `deleteSession(id: string): boolean` and `getSessionMessageCount(sessionId: string): number` to both the interface and the implementation

**Implementation:**

The design's sessions screen needs to delete sessions and display message counts. Neither exists in the store.

Add to the `Store` interface (after `clearMessages`):

```typescript
deleteSession(id: string): boolean;
getSessionMessageCount(sessionId: string): number;
```

Add prepared statements:

```typescript
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const stmtDeleteSessionMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);
const stmtMessageCount = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ?`);
```

Add implementations:

```typescript
deleteSession(id: string): boolean {
  stmtDeleteSessionMessages.run(id);
  return stmtDeleteSession.run(id).changes > 0;
},

getSessionMessageCount(sessionId: string): number {
  const row = stmtMessageCount.get(sessionId) as { count: number } | null;
  return row?.count ?? 0;
},
```

`deleteSession` cascades manually by deleting messages first, then the session row. Returns `true` if the session existed.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(store): add deleteSession and getSessionMessageCount`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/tui/screens/SessionsScreen.tsx`

**Verifies:** GH13.AC1.1, GH13.AC1.2, GH13.AC1.3, GH13.AC2.1, GH13.AC2.2

**Files:**
- Create: `src/tui/screens/SessionsScreen.tsx`

**Implementation:**

The sessions screen is the TUI landing page. It shows a header bar with aggregate stats, a scrollable session list, and keybindings.

Props:

```typescript
type SessionsScreenProps = {
  readonly store: Store;
  readonly modelName: string;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: TuiDependencies['customTools'];
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
};
```

Component structure:

1. **Header bar:** `constellation-lite — {modelName}` plus counts:
   - Secret count from `secrets?.listKeys().length ?? 0`
   - Schedule count from `scheduler?.list().length ?? 0`
   - Custom tool count from `customTools?.listTools()` (show `approved/total`)
2. **Session list:** Fetched via `store.listSessions(50)`. For each session:
   - Title (fallback to "Untitled session")
   - Updated date formatted as relative or short date
   - Message count from `store.getSessionMessageCount(session.id)`
3. **Keybindings:**
   - `j`/`k` or arrow keys to navigate
   - `Enter` to select → calls `onSelectSession(sessionId)`
   - `n` to create new session → calls `onNewSession()`
   - `d` to delete selected session → calls `store.deleteSession(id)` then refreshes
4. **Empty state:** When no sessions exist, show "No sessions yet. Press n to start a new conversation."

The session list uses a `selectedIdx` state and `useInput` for navigation. Refresh the session list after any mutation (create/delete).

Date formatting helper — keep it simple:

```typescript
function formatDate(iso: string): string {
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
```

Pattern comment: `// pattern: UI Shell — session list and navigation`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add SessionsScreen with list, create, delete`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire SessionsScreen into App.tsx

**Files:**
- Modify: `src/tui/App.tsx` — replace the sessions placeholder with the real component

**Implementation:**

Import `SessionsScreen` and wire it into the `switch` statement:

```typescript
case 'sessions':
  return (
    <SessionsScreen
      store={deps.store}
      modelName={deps.modelName}
      secrets={deps.secrets}
      scheduler={deps.scheduler}
      customTools={deps.customTools}
      onSelectSession={(sessionId) => {
        setActiveSessionId(sessionId);
        push('chat');
      }}
      onNewSession={() => {
        const id = crypto.randomUUID();
        deps.store.createSession(id);
        setActiveSessionId(id);
        push('chat');
      }}
    />
  );
```

The `activeSessionId` state was added in Phase 1's App.tsx refactor. When a session is selected or created, it's stored and the chat screen is pushed.

Also: when the chat screen pops back (via Escape), the sessions list should refresh. This happens naturally because React re-renders when the screen changes.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire SessionsScreen into navigation shell`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
