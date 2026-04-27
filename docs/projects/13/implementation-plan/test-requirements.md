# GH13: Multi-Screen TUI — Test Requirements

This document maps each acceptance criterion to either an automated test or a documented human verification approach.

## Testing Strategy

This project is a TUI (terminal UI) built with Ink/React. The codebase currently has **zero test files** and no test infrastructure for Ink components. Ink 7 provides `renderToString` for static snapshot testing, but interactive behaviour (key events, state changes) requires `ink-testing-library` or manual integration tests.

Given the nature of this feature (predominantly UI wiring with minimal business logic), the testing approach is:

1. **Pure function unit tests** — for shared utilities (`formatDate`, `parseDescription`) and store additions (`deleteSession`, `getSessionMessageCount`, `setEnabled`)
2. **Human verification** — for interactive screen behaviour (navigation, key bindings, rendering). These are UI interactions that are expensive to automate and change frequently during development.

### Test Files

| Test File | What It Covers |
|-----------|---------------|
| `src/tui/util.test.ts` | `formatDate`, `parseDescription` |
| `src/store/store.test.ts` | `deleteSession`, `getSessionMessageCount` |
| `src/scheduler/scheduler.test.ts` | `setEnabled` toggle behaviour |

---

## Automated Tests

### GH13.AC1: Sessions screen lists sessions with titles and dates

**GH13.AC1.1:** Session title display, date formatting, message count
- **Test type:** Unit (for `formatDate` utility)
- **Test file:** `src/tui/util.test.ts`
- **Tests:**
  - `formatDate` returns "just now" for timestamps < 1 minute ago
  - `formatDate` returns "Xm ago" for timestamps < 1 hour ago
  - `formatDate` returns "Xh ago" for timestamps < 24 hours ago
  - `formatDate` returns "Xd ago" for timestamps < 7 days ago
  - `formatDate` returns YYYY-MM-DD for older timestamps

**GH13.AC1.2:** Sessions sorted by most recent
- **Test type:** Unit (store behaviour)
- **Test file:** `src/store/store.test.ts`
- **Tests:**
  - `listSessions` returns sessions ordered by `updated_at` DESC

**GH13.AC1.3:** Empty state display
- **Test type:** Human verification (see below)

### GH13.AC2: New session creation

**GH13.AC2.1:** Creating a new session
- **Test type:** Unit (store behaviour)
- **Test file:** `src/store/store.test.ts`
- **Tests:**
  - `createSession` followed by `getSession` returns the created session
  - `deleteSession` removes the session and its messages
  - `getSessionMessageCount` returns correct count after `appendMessage`
  - `deleteSession` returns false for non-existent session

### GH13.AC8.2: Task enable/disable toggle

- **Test type:** Unit (scheduler behaviour)
- **Test file:** `src/scheduler/scheduler.test.ts`
- **Tests:**
  - `setEnabled(id, false)` sets task state to disabled
  - `setEnabled(id, true)` re-enables a disabled task
  - `setEnabled` with non-existent ID returns false
  - Disabled tasks appear in `list()` with `enabled: false`

### Utility functions

- **Test type:** Unit
- **Test file:** `src/tui/util.test.ts`
- **Tests:**
  - `parseDescription` extracts description from `// Description: ...` header
  - `parseDescription` returns empty string when no description header exists
  - `parseDescription` handles various whitespace patterns

---

## Human Verification

The following criteria require interactive verification because they involve key bindings, screen transitions, and Ink rendering behaviour that are not cost-effective to automate.

### GH13.AC3: Chat screen event indicators

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC3.1: `llm_start` shows "Thinking..." spinner | Run `bun start`, open a session, send a message. Observe spinner appears during model call. |
| GH13.AC3.2: `tool_start` shows "Running code..." | Send a message that triggers tool use (e.g., "list my documents"). Observe status changes to "Running code..." |
| GH13.AC3.3: `llm_done` updates stats | After response, observe token stats in status bar. |
| GH13.AC3.4: Token stats bar shows input/output/rounds/duration | After response, verify status bar format matches `ctx X/Y (Z%) · in X · out X · calls N · Xs` |

### GH13.AC4-6: Tools screen

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC4.1: Custom tools listed | With custom tools feature enabled, navigate to tools screen (press `t`). Verify custom tools section shows tools. |
| GH13.AC4.2: Approve custom tool | Select a custom tool, press `a`. Verify status changes to approved. |
| GH13.AC4.3: Revoke custom tool | Select an approved tool, press `r`. Verify status changes to revoked. |
| GH13.AC4.4: No custom tools fallback | Without custom tools configured, verify "Custom tools not available" message. |
| GH13.AC5.1: Built-in tools listed | Verify built-in tools section shows the 8 registered tools (doc_upsert, doc_get, etc.) |
| GH13.AC5.2: Built-in tools read-only | Verify no approve/revoke actions available for built-in tools. |
| GH13.AC6.1: Skills listed with grant status | Save a skill document, verify it appears in skills section with pending status. |
| GH13.AC6.2: Grant/revoke skills | Press `g` to grant, `r` to revoke. Verify status icon changes. |
| GH13.AC6.3: View skill code | Press `v` on a skill. Verify code is displayed. Press Escape to return. |
| GH13.AC6.4: Edit secret assignments | Press `s` on a granted skill. Verify secret toggle list appears. Toggle secrets, press Escape. Verify assignments saved. |

### GH13.AC7: Secrets screen

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC7.1: Secret names listed, values hidden | Press `s` to open secrets screen. Verify only names are shown. |
| GH13.AC7.2: Add secret flow | Press `a`, enter name, enter value. Verify secret appears in list. |
| GH13.AC7.3: Delete secret | Select a secret, press `d`. Verify it's removed from the list. |
| GH13.AC7.4: Skills using each secret | Verify "used by: skill:xyz" annotations next to secrets that are referenced by skill grants. |
| GH13.AC7.5: Empty state | With no secrets, verify "No secrets configured" message. |

### GH13.AC8: Schedules screen

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC8.1: Task list with metadata | Create a scheduled task via the agent. Press `c` to open schedules screen. Verify name, schedule, run count, last run info. |
| GH13.AC8.3: Last run display | After a task has run, verify last run timestamp, success/failure, and duration are shown. |
| GH13.AC8.4: Empty state | With no tasks, verify "No scheduled tasks" message. |

### GH13.AC9: System prompt screen

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC9.1: Full prompt displayed | Press `p` to open prompt screen. Verify persona, time, memory, skills, and tool docs are visible. |
| GH13.AC9.2: Scroll with j/k | Verify `j` scrolls down, `k` scrolls up. |
| GH13.AC9.3: Page Up/Page Down | Verify Page Up/Down scroll by larger increments. |
| GH13.AC9.4: Read-only | Verify no editing is possible. |

### GH13.AC10-11: Navigation

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC10.1-5: Global nav keys | From sessions screen, press `t`/`s`/`c`/`p`/`q`. Verify correct screen appears (or app quits). |
| GH13.AC11.1: Escape pops stack | From any pushed screen, press Escape. Verify return to previous screen. |
| GH13.AC11.2: Escape on root | On sessions screen, press Escape. Verify nothing happens. |

### GH13.AC12: Dependency wiring

| Criterion | Verification Approach |
|-----------|----------------------|
| GH13.AC12.1: startTUI accepts all deps | Verify `npx tsc --noEmit` passes — type checker confirms the interface. |
| GH13.AC12.2: Screens receive correct deps | Code review: each screen's props match the deps passed from App.tsx. |

---

## Test Execution

```bash
# Run all tests
cd /Users/scarndp/dev/johnson/.worktrees/GH13
bun test

# Run specific test files
bun test src/tui/util.test.ts
bun test src/store/store.test.ts
bun test src/scheduler/scheduler.test.ts
```
