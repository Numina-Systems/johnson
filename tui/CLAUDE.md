# Go TUI (Bubble Tea)

Last verified: 2026-05-09

## Purpose

Replaces the Ink/React TUI with a native Go terminal UI using Bubble Tea. Communicates with the TS backend exclusively via JSON-RPC 2.0 over stdin/stdout, enforcing a clean process boundary between UI and agent logic.

## Contracts

- **Exposes**: `constellation-tui` binary (built to `bin/`)
- **Guarantees**: Backend process lifecycle management with crash detection and restart. Protocol version `"1"` handshake required before any RPC calls. All backend interaction goes through `protocol.Client` -- no direct store or agent access. Startup creates a session via `session/create` RPC and boots to Chat (graceful fallback to Sessions list on failure). Navigation uses a generic screen stack with `popScreenMsg` (not screen-specific messages). Slash commands: `/sessions`, `/tools`, `/secrets`, `/schedules`, `/prompt`, `/new`, `/back`, `/quit`.
- **Expects**: TS backend available at `../src/index.ts` (run via `bun`). Backend must emit a `ready` notification with `protocolVersion: "1"` on startup.

## Dependencies

- **Uses**: `charm.land/bubbletea/v2`, `github.com/sourcegraph/jsonrpc2`
- **Used by**: End users (primary TUI entry point)
- **Boundary**: Never imports TS code. All backend interaction is RPC.

## Key Decisions

- **Separate process**: Go TUI spawns TS backend as a child process rather than embedding. Keeps the rendering pipeline (Go) decoupled from the agent pipeline (TS/Bun).
- **Line-delimited JSON-RPC**: Uses newline-delimited JSON (not HTTP or LSP headers) for simplicity and debuggability.
- **Fire-and-forget chat**: `agent/chat` returns a `requestId` immediately; responses arrive as `agent/response` notifications. This keeps the TUI responsive during long agent runs.
- **Chat-first startup**: `main.go` creates a session via RPC before initializing `AppModel`, so users land directly in Chat. The Sessions list is lazy-initialized only when navigated to via `/sessions`. `NavigateToChatMsg` resets the screen stack to `[ScreenChat]` rather than pushing, preventing unbounded stack growth.
- **Generic screen stack**: All screens use `popScreenMsg` for escape/back. The old `backToSessionsMsg` was removed in favour of this generic approach.
- **`--with-discord` flag**: Spawns backend in `both` mode (jsonrpc + discord), enabling Discord coexistence without a separate process.

## Structure

- `cmd/constellation-tui/main.go` -- Entry point: spawns backend, creates initial session via `session/create` RPC, creates client, runs Bubble Tea program. If session creation fails, falls back to sessions list.
- `internal/app/` -- Screen models (sessions, chat, tools, secrets, schedules, prompt) and navigation
  - `app.go` -- `NewAppModel(client, backend, initialSessionID)` -- accepts 3 params; when `initialSessionID` is non-empty, boots directly to Chat screen with that session. Screen stack root is Chat (not Sessions).
  - `session_delegate.go` -- Compact single-line session list rendering with `sessionDelegate` (Height 1, Spacing 0). Shows title, message count, and relative timestamp on one line.
  - `chat.go` -- Chat screen with error state tracking (`statusError` bool, `messagesErrorMsg`, `loadOlderErrorMsg`). Errors render in red.
  - `sessions.go` -- Sessions list using `sessionDelegate`. Untitled sessions display truncated session ID. Escape pops screen stack (except during list filtering).
- `internal/backend/process.go` -- Backend process lifecycle (start, shutdown, restart, crash detection)
- `internal/protocol/` -- JSON-RPC client, transport (line codec), and shared types
- `internal/layout/` -- Reusable layout components (split panes)
- `internal/render/` -- Message rendering utilities

## Invariants

- Stdout of the TS backend is exclusively JSON-RPC -- `enforceStdoutDiscipline()` in the backend redirects all console output to stderr
- Backend crash triggers a recoverable state in the TUI (user can press `r` to restart)
- Protocol version mismatch causes immediate exit with a clear error
