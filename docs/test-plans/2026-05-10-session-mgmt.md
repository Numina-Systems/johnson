# Human Test Plan: Session Management

## Prerequisites

- Working `config.toml` with valid model API keys
- `bun test` passes (55 tests, 0 failures)
- `bun run build` compiles without errors
- At least 3-4 pre-existing sessions in the store (mix of recent and old, empty and with messages)

## Phase 1: Prune Screen Access and Rendering (AC5.1, AC5.6)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun start` | TUI launches, Sessions screen visible |
| 2 | Verify status bar at bottom of Sessions screen | `r` keybinding label visible |
| 3 | Press `r` | Prune Screen renders, replacing Sessions screen |
| 4 | Inspect each session row | Each row shows: title (or "Untitled session"), message count `(N msgs)`, relative time |
| 5 | Inspect classification badges | Coloured badges: `[delete]` (empty >24h), `[archive]` (messages >3d), `[active]` (recent) |
| 6 | Verify empty-state rendering | If no sessions exist, screen handles gracefully |

## Phase 2: Selection and Keyboard Navigation (AC5.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `j` | Cursor moves down one row |
| 2 | Press `k` | Cursor moves back up |
| 3 | Press `j` past last row | Cursor stays on last row |
| 4 | Navigate to a row and press `space` | Checkbox toggles on |
| 5 | Press `space` again | Checkbox toggles off |
| 6 | Select multiple sessions with `space` | Multiple checkboxes show selected |
| 7 | Press `a` | All `[delete]` and `[archive]` sessions selected; `[active]` unselected |

## Phase 3: Confirmation Dialog (AC5.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Select at least one session | One or more sessions selected |
| 2 | Press `enter` | Confirmation summary: "Archive N sessions, delete M sessions. Proceed? (y/n)" |
| 3 | Verify counts | Archive count = selected sessions with messages; delete count = selected empty sessions |
| 4 | Press `n` | Returns to selection mode, selections preserved |
| 5 | Press `enter` again | Confirmation reappears |

## Phase 4: Execution and Store Mutations (AC5.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | From confirmation, press `y` | Processing begins |
| 2 | Wait for completion | Result message with counts shown |
| 3 | Press `escape` to return to Sessions screen | Pruned sessions gone from list |
| 4 | Verify archive documents | `sqlite3 data/constellation.db "SELECT rkey FROM documents WHERE rkey LIKE 'archive:session:%'"` shows archived sessions |
| 5 | Verify deleted sessions gone | Empty sessions classified `[delete]` no longer in sessions list and have no archive document |

## Phase 5: Escape/Cancel Navigation (AC5.5)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Press `r` from Sessions screen | Prune Screen renders |
| 2 | Select sessions with `space` | Sessions selected |
| 3 | Press `escape` (without confirming) | Returns to Sessions screen |
| 4 | Verify no sessions modified | All sessions still present |
| 5 | Press `r` again | Prune Screen renders fresh (no persisted selections) |

## End-to-End: Full Prune Lifecycle

1. Start TUI with `bun start`
2. Create a session, send 2-3 messages, return to Sessions screen
3. Create another session, send nothing (empty)
4. Ensure at least one session is >3 days old with messages
5. Press `r` to open Prune Screen
6. Verify classifications match expectations
7. Press `a` to select all stale
8. Press `enter` for confirmation
9. Verify summary counts are correct
10. Press `y` to execute
11. Return to Sessions screen
12. Confirm recent sessions still present, old stale sessions gone
13. Query SQLite DB for `archive:session:*` documents

## Traceability

| AC | Automated Test | Manual Step |
|----|---------------|-------------|
| AC1.1-AC1.3 | `src/store/store.test.ts` | -- |
| AC2.1-AC2.8 | `src/sessions/archive.test.ts` | -- |
| AC3.1-AC3.7 | `src/sessions/archiver.test.ts` | -- |
| AC4.1-AC4.4 | `src/tools/sessions.test.ts` | -- |
| AC5.1 | -- | Phase 1, Steps 4-6 |
| AC5.2 | -- | Phase 2, Steps 1-7 |
| AC5.3 | -- | Phase 3, Steps 1-5 |
| AC5.4 | -- | Phase 4, Steps 1-5 |
| AC5.5 | -- | Phase 5, Steps 1-5 |
| AC5.6 | -- | Phase 1, Steps 2-3 |
