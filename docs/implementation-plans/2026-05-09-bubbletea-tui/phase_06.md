# Bubbletea TUI Implementation Plan — Phase 6: Error Handling, Discord Integration & Polish

**Goal:** Production hardening — crash detection/recovery, Discord coexistence, clean shutdown, protocol version negotiation, and build coordination.

**Architecture:** The Go TUI manages the backend's full lifecycle: spawn on start, SIGTERM on exit, SIGKILL fallback on timeout. Backend crash detection via broken pipe / unexpected exit triggers recovery UI. The `--with-discord` flag passes `--interface both` to the backend so Discord runs alongside jsonrpc. A justfile coordinates Go and TS builds.

**Tech Stack:** Go 1.26, bubbletea v2, TypeScript/Bun, just (task runner)

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.1 Success:** Backend starts in jsonrpc mode and emits `ready` notification with protocol version and capabilities

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.3 Failure:** Backend crash during chat sends broken-pipe signal that TUI detects and shows recovery UI

### bubbletea-tui.AC4: Discord-only mode works independently
- **bubbletea-tui.AC4.1 Success:** `bun start --interface discord` starts Discord bot without requiring the Go TUI
- **bubbletea-tui.AC4.2 Success:** `constellation-tui --with-discord` starts both TUI and Discord in the same backend process
- **bubbletea-tui.AC4.3 Success:** TUI exit cleanly shuts down the backend (including Discord) via SIGTERM

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add CLI argument parsing for --interface in TS backend

**Verifies:** bubbletea-tui.AC4.1, bubbletea-tui.AC4.2

**Files:**
- Modify: `src/config/loader.ts` — parse `--interface` from argv, override config.toml value
- Modify: `src/config/types.ts` — already has `'jsonrpc'` in InterfaceMode from Phase 1; add `'both'` variant for jsonrpc+discord if not already covered

**Implementation:**

In `src/config/loader.ts`, after loading from config.toml, check `process.argv` for `--interface <mode>`:

```typescript
function parseInterfaceFromArgv(): InterfaceMode | null {
  const idx = process.argv.indexOf('--interface');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const value = process.argv[idx + 1];
  const valid: ReadonlyArray<string> = ['tui', 'discord', 'both', 'jsonrpc'];
  if (valid.includes(value)) return value as InterfaceMode;
  return null;
}
```

Call this after loading the TOML config and use the result to override the interface mode if present. The existing `rawInterface` normalization at lines 149-151 should be updated to respect the argv override.

Currently the loader defaults unknown values to `'tui'`. Update it so:
1. Check argv for `--interface` override
2. If present, use that
3. Otherwise fall back to config.toml value
4. If neither, default to `'tui'`

**Testing:**

Tests must verify:
- bubbletea-tui.AC4.1: `--interface discord` results in discord mode
- bubbletea-tui.AC4.2: `--interface both` results in both mode
- Edge: `--interface jsonrpc` results in jsonrpc mode
- Edge: no `--interface` flag falls back to config.toml value

Add tests to `src/config/loader.test.ts`.

**Verification:**

```bash
bun test src/config/
```

Expected: All tests pass.

**Commit:** `feat(config): parse --interface from CLI arguments`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Handle jsonrpc+discord combined mode in index.ts

**Verifies:** bubbletea-tui.AC4.2

**Files:**
- Modify: `src/index.ts` — ensure jsonrpc mode block runs alongside discord when mode is `'both'` with jsonrpc

**Implementation:**

Currently `src/index.ts` lines 154-187 have:
- `if (mode === 'tui' || mode === 'both')` — start TUI
- `if (mode === 'discord' || mode === 'both')` — start Discord

The Go TUI passes `--interface both` when `--with-discord` is used. This means the backend needs to start BOTH jsonrpc AND discord. The `'both'` mode currently starts TUI+Discord.

Two options:
1. Redefine `'both'` to mean jsonrpc+discord (since the TUI will be Go, not Ink)
2. Add a new mode value

Option 1 is cleaner since Ink TUI will eventually be removed. Update the branching:

```typescript
// Start jsonrpc server (for Go TUI)
if (mode === 'jsonrpc' || mode === 'both') {
  enforceStdoutDiscipline();
  const jsonrpcDeps: JsonRpcDependencies = { /* ... */ };
  const handlers = createHandlers(jsonrpcDeps);
  startJsonRpcServer(handlers);
}

// Start Ink TUI (legacy, will be removed)
if (mode === 'tui') {
  // existing TUI code...
}

// Start Discord bot
if (mode === 'discord' || mode === 'both') {
  // existing Discord code...
}
```

Move `enforceStdoutDiscipline()` call into the jsonrpc block (it was added in Phase 1 before config load — move it to after config load, inside the mode check).

**Testing:**

Tests must verify:
- bubbletea-tui.AC4.2: mode `'both'` starts both jsonrpc server and Discord bot

Extend existing handler tests to cover the combined mode wiring.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat: support jsonrpc+discord combined mode`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Go backend process lifecycle manager

**Files:**
- Create: `tui/internal/backend/process.go`

**Implementation:**

Create `tui/internal/backend/process.go`:

Define `BackendProcess` struct:
```go
type BackendProcess struct {
	cmd         *exec.Cmd
	cancel      context.CancelFunc
	withDiscord bool
	workDir     string
	stderr      io.ReadCloser
	exited      chan error  // closed when process exits
}
```

Methods:

**`NewBackendProcess(workDir string, withDiscord bool) *BackendProcess`** — creates the struct.

**`Start(ctx context.Context) (io.ReadCloser, io.WriteCloser, error)`** — starts the backend:
- Create child context with cancel
- Build command: `bun run src/index.ts --interface jsonrpc` (or `--interface both` if withDiscord)
- Set `cmd.Dir` to workDir
- Pipe stderr to os.Stderr
- Create stdin/stdout pipes for JSON-RPC
- Start the process
- Launch goroutine that calls `cmd.Wait()` and sends result to `exited` channel
- Return stdout (ReadCloser) and stdin (WriteCloser) for JSON-RPC transport

**`Shutdown(timeout time.Duration) error`** — graceful shutdown:
1. Send SIGTERM to process
2. Wait for exit with timeout
3. If timeout, send SIGKILL
4. Return exit error

**`WaitExit() <-chan error`** — returns the exited channel for crash detection

**`Restart(ctx context.Context) (io.ReadCloser, io.WriteCloser, error)`** — kill old process (if still running), start new one.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add backend process lifecycle manager`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Go crash detection and recovery UI

**Verifies:** bubbletea-tui.AC3.3

**Files:**
- Modify: `tui/internal/app/app.go` — add crash detection loop and recovery state

**Implementation:**

Add to AppModel:
```go
type AppModel struct {
	// existing fields...
	backend  *backend.BackendProcess
	crashed  bool
	crashErr string
}
```

In root model Update, handle a custom `backendCrashedMsg`:
- Set `crashed = true`, `crashErr = error message`
- Show recovery UI instead of normal screen

Define `backendCrashedMsg` and a command that watches the backend exit channel:

```go
type backendCrashedMsg struct {
	err error
}

func watchBackend(proc *backend.BackendProcess) tea.Cmd {
	return func() tea.Msg {
		err := <-proc.WaitExit()
		return backendCrashedMsg{err: err}
	}
}
```

In Init(), start the watch command alongside other initialization.

Recovery UI View:
```
Backend process exited unexpectedly.

Error: <crash error message>

Press 'r' to restart, or 'q' to quit.
```

When user presses `r`:
- Call `backend.Restart(ctx)` to spawn new process
- Create new protocol client
- Wait for ready notification
- Reset all screen models
- Set `crashed = false`
- Resume normal operation

When backend exits cleanly (no error, user initiated), don't show crash UI.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add crash detection and recovery UI`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Go entry point — --with-discord flag and protocol version check

**Verifies:** bubbletea-tui.AC4.2, bubbletea-tui.AC4.3, bubbletea-tui.AC1.1

**Files:**
- Modify: `tui/cmd/constellation-tui/main.go` — add --with-discord flag, use BackendProcess, add protocol version check

**Implementation:**

Replace the current main.go with full lifecycle management:

```go
func main() {
	withDiscord := flag.Bool("with-discord", false, "Start Discord bot alongside TUI")
	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	proc := backend.NewBackendProcess("..", *withDiscord)
	stdout, stdin, err := proc.Start(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start backend: %v\n", err)
		os.Exit(1)
	}

	client, err := protocol.NewClient(ctx, stdout, stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create protocol client: %v\n", err)
		os.Exit(1)
	}

	ready, err := client.WaitReady(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to receive ready: %v\n", err)
		os.Exit(1)
	}

	// Protocol version check
	if ready.ProtocolVersion != "1" {
		fmt.Fprintf(os.Stderr, "unsupported protocol version: %s (expected 1)\n", ready.ProtocolVersion)
		proc.Shutdown(5 * time.Second)
		os.Exit(1)
	}

	appModel := app.NewAppModel(client, proc)
	p := tea.NewProgram(appModel)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %v\n", err)
	}

	// Clean shutdown
	client.Close()
	if err := proc.Shutdown(5 * time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "backend shutdown: %v\n", err)
	}
}
```

Use stdlib `flag` package — simple enough for one boolean flag.

**Verification:**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && echo "Binary built"
rm -f constellation-tui
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add --with-discord flag and protocol version check`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Build coordination with justfile

**Files:**
- Create: `justfile` (project root)

**Implementation:**

Create `justfile` in the project root:

```justfile
# Default recipe
default: build

# Build everything
build: build-ts build-go

# Build TypeScript backend
build-ts:
	bun run build

# Build Go TUI
build-go:
	cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/

# Run tests
test: test-ts test-go

# Test TypeScript
test-ts:
	bun test

# Test Go
test-go:
	cd tui && go test ./...

# Run TUI (dev mode — no build)
dev:
	cd tui && go run ./cmd/constellation-tui/

# Run TUI with Discord
dev-discord:
	cd tui && go run ./cmd/constellation-tui/ --with-discord

# Run Discord only (no TUI)
discord:
	bun run src/index.ts --interface discord

# Clean build artifacts
clean:
	rm -rf dist bin
	cd tui && go clean

# Format Go code
fmt:
	cd tui && gofmt -w .
```

Create `bin/` in `.gitignore` if not already present.

**Verification:**

```bash
just build
```

Expected: Both TS and Go builds succeed, `bin/constellation-tui` exists.

```bash
just test
```

Expected: All tests pass.

**Commit:** `chore: add justfile for build coordination`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: End-to-end verification — full production flow

**Step 1: Build and run**

```bash
just build && bin/constellation-tui
```

**Step 2: Verify normal operation**

1. TUI launches, shows sessions screen
2. All screens accessible via ctrl+ keybindings
3. Chat works with streaming events
4. Tools, secrets, schedules, prompt screens all functional
5. `ctrl+c` quits cleanly (no orphan processes)

**Step 3: Verify crash recovery**

1. Start TUI
2. Find the backend process PID: `ps aux | grep 'bun run src/index.ts'`
3. Kill it: `kill <pid>`
4. TUI should show crash recovery screen
5. Press `r` to restart — should reconnect and resume

**Step 4: Verify Discord integration**

```bash
bin/constellation-tui --with-discord
```

1. TUI launches normally
2. Discord bot should also be online (verify in Discord)
3. `ctrl+c` should shut down both TUI and Discord

**Step 5: Verify Discord-only mode**

```bash
just discord
```

1. Discord bot starts without TUI
2. Responds to messages in Discord
3. `ctrl+c` shuts down cleanly

**Step 6: Verify protocol version mismatch**

Temporarily change the `ready` notification's protocolVersion in `src/jsonrpc/notifications.ts` to `"999"`, rebuild, and run. TUI should show "unsupported protocol version" error and exit.

**Step 7: Clean up**

```bash
just clean
```

**Commit:** No commit — verification only.

<!-- END_TASK_7 -->
