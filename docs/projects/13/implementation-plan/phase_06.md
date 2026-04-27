# GH13: Multi-Screen TUI — Phase 6: Schedules Screen

**Goal:** Build the schedules screen that lists scheduled tasks with their status and supports enable/disable toggling.

**Architecture:** The schedules screen reads from `TaskStore.list()` to get all scheduled tasks and their run state. It displays task metadata (name, schedule expression, last run time/status, run count) and allows toggling enabled/disabled via a keybinding. The screen is otherwise read-only — tasks are created by the agent, not the operator.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 6 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC8: Schedules screen lists tasks with enable/disable toggle
- **GH13.AC8.1:** Tasks are listed with name, schedule expression, enabled/disabled status, run count, and last run info
- **GH13.AC8.2:** Pressing `e` toggles the selected task between enabled and disabled
- **GH13.AC8.3:** Last run shows timestamp, success/failure status, and duration
- **GH13.AC8.4:** Empty state shows "No scheduled tasks" when none exist

---

## Prerequisite: TaskStore Enable/Disable Support

The `TaskStore` interface (`src/scheduler/types.ts`) has `enabled: boolean` on `ScheduledTask`, but the scheduler implementation (`src/scheduler/scheduler.ts`) does not expose a method to toggle it. The current API is:

- `schedule(task)` — creates and starts a task
- `cancel(id)` — stops and removes a task
- `list()` — returns all tasks
- `get(id)` — returns one task

There is no `setEnabled(id, enabled)` method. The TUI needs one.

This phase adds a `setEnabled(id: string, enabled: boolean): boolean` method to `TaskStore` and implements it in the scheduler. When disabled, the cron job is stopped but the task remains in the list. When re-enabled, the cron job is restarted.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `setEnabled` to TaskStore and scheduler

**Files:**
- Modify: `src/scheduler/types.ts` — add `setEnabled(id: string, enabled: boolean): boolean` to `TaskStore`
- Modify: `src/scheduler/scheduler.ts` — implement `setEnabled`

**Implementation:**

**`src/scheduler/types.ts`** — Add to the `TaskStore` type:

```typescript
setEnabled(id: string, enabled: boolean): boolean;
```

**`src/scheduler/scheduler.ts`** — Add implementation in the returned object:

```typescript
setEnabled(id: string, enabled: boolean): boolean {
  const live = tasks.get(id);
  if (!live) return false;

  if (enabled && !live.state.enabled) {
    // Re-enable: restart the cron
    live.state = { ...live.state, enabled: true };
    live.cron = new Cron(normalizeSchedule(live.state.schedule), { catch: true });
    live.cron.schedule(() => {
      runTask(live).catch((err) => {
        log(`[scheduler] Unhandled error in task "${live.state.name}": ${err}`);
      });
    });
    log(`[scheduler] Enabled "${live.state.name}"`);
  } else if (!enabled && live.state.enabled) {
    // Disable: stop the cron but keep the task
    live.cron.stop();
    live.state = { ...live.state, enabled: false };
    log(`[scheduler] Disabled "${live.state.name}"`);
  }

  persist().catch(() => {});
  return true;
},
```

Also update `scheduleCron` and `start()` to respect the `enabled` field — if a rehydrated task has `enabled: false`, don't start its cron:

In `scheduleCron`, add a check after creating the cron:
```typescript
function scheduleCron(task: TaskState): LiveTask {
  const cronExpr = normalizeSchedule(task.schedule);
  const cron = new Cron(cronExpr, { catch: true });
  const live: LiveTask = { state: task, cron, running: false };

  if (task.enabled !== false) {
    cron.schedule(() => {
      runTask(live).catch((err) => {
        log(`[scheduler] Unhandled error in task "${live.state.name}": ${err}`);
      });
    });
  }

  return live;
}
```

Note: Existing tasks don't have an explicit `enabled` field in the persisted JSON (they predate #13). Checking `task.enabled !== false` treats missing/undefined as enabled, maintaining backward compatibility.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(scheduler): add setEnabled for task enable/disable toggle`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/tui/screens/SchedulesScreen.tsx`

**Verifies:** GH13.AC8.1, GH13.AC8.2, GH13.AC8.3, GH13.AC8.4

**Files:**
- Create: `src/tui/screens/SchedulesScreen.tsx`

**Implementation:**

**Props:**

```typescript
type SchedulesScreenProps = {
  readonly scheduler: TaskStore;
  readonly onBack: () => void;
};
```

**State:**

```typescript
const [selectedIdx, setSelectedIdx] = useState(0);
const [tasks, setTasks] = useState<TaskState[]>([]);

// Refresh task list
const refresh = useCallback(() => {
  setTasks(scheduler.list());
}, [scheduler]);

useEffect(() => { refresh(); }, [refresh]);
```

**Key bindings:**
- `j`/`k` or up/down arrows — navigate
- `e` — toggle enabled/disabled on the selected task
- `Escape` — call `onBack()`

Toggle logic:
```typescript
if (input === 'e' && selectedTask) {
  scheduler.setEnabled(selectedTask.id, !selectedTask.enabled);
  refresh();
}
```

**Layout for each task:**

```
> ✅ world-news-update
     Schedule: 0 */6 * * * (every 6h)
     Runs: 14 | Last: 2h ago ✅ (3.2s)

  ⏸ daily-digest
     Schedule: 0 9 * * * (daily at 9am)
     Runs: 0 | Never run
     [DISABLED]
```

Status icon: `✅` for enabled, `⏸` for disabled.

Last run formatting:
- If `lastRun` is undefined: "Never run"
- If `lastRun` exists: relative time + success/failure icon + duration
  - e.g., "2h ago ✅ (3.2s)" or "5m ago ❌ (12.1s)"

Reuse the `formatDate` helper from SessionsScreen (or extract it to a shared `src/tui/util.ts` if both screens need it).

**Empty state:**
```
(No scheduled tasks. The agent creates tasks via the schedule_task tool.)
```

Pattern comment: `// pattern: UI Shell — scheduled task list with enable/disable`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add SchedulesScreen with task list and enable/disable toggle`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire SchedulesScreen into App.tsx

**Files:**
- Modify: `src/tui/App.tsx` — replace schedules placeholder with real component

**Implementation:**

```typescript
case 'schedules':
  if (!deps.scheduler) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Scheduler not available.</Text>
        <Text dimColor>Press Escape to go back.</Text>
      </Box>
    );
  }
  return (
    <SchedulesScreen
      scheduler={deps.scheduler}
      onBack={pop}
    />
  );
```

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire SchedulesScreen into navigation shell`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
