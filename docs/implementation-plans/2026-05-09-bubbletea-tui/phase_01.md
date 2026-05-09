# Bubbletea TUI Implementation Plan — Phase 1: Protocol Foundation

**Goal:** Establish the JSON-RPC 2.0 transport between Go TUI and TS backend so they can exchange messages.

**Architecture:** The Go TUI spawns the TS backend as a child process and communicates over stdin/stdout using line-delimited JSON-RPC 2.0. The TS backend gains a `jsonrpc` interface mode that redirects all console output to stderr, emits a `ready` notification on startup, and processes incoming JSON-RPC requests.

**Tech Stack:** Go 1.26, bubbletea v2 (charm.land/bubbletea/v2), sourcegraph/jsonrpc2 v0.2.1, TypeScript/Bun

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

This phase is infrastructure — verified operationally, not by tests.

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.1 Success:** Backend starts in jsonrpc mode and emits `ready` notification with protocol version and capabilities
- **bubbletea-tui.AC1.7 Edge:** Only JSON-RPC messages appear on stdout in jsonrpc mode — no stray console.log output

**Verifies: None** — infrastructure phase, verified operationally.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Go module initialisation and entry point

**Files:**
- Create: `tui/go.mod`
- Create: `tui/cmd/constellation-tui/main.go`

**Step 1: Create Go module**

```bash
mkdir -p tui/cmd/constellation-tui
cd tui && go mod init constellation-tui && cd ..
```

**Step 2: Add dependencies**

```bash
cd tui && go get github.com/sourcegraph/jsonrpc2@v0.2.1 && cd ..
```

**Step 2b: Verify Charm stack import paths**

The implementation plan uses bubbletea v2 import paths (`charm.land/bubbletea/v2`, `charm.land/bubbles/v2`, `charm.land/lipgloss/v2`, `charm.land/glamour/v2`). These must be verified before proceeding.

```bash
cd tui && go get charm.land/bubbletea/v2 2>&1 || echo "FALLBACK_NEEDED"
```

**If `charm.land/bubbletea/v2` resolves:** Proceed with v2 import paths as written in all phases. Also run:
```bash
go get charm.land/bubbles/v2 charm.land/lipgloss/v2 charm.land/glamour/v2
```

**If `charm.land/bubbletea/v2` fails to resolve (FALLBACK_NEEDED):** Update ALL Go import paths across ALL phases to use v1:
- `charm.land/bubbletea/v2` → `github.com/charmbracelet/bubbletea`
- `charm.land/bubbles/v2/list` → `github.com/charmbracelet/bubbles/list`
- `charm.land/bubbles/v2/viewport` → `github.com/charmbracelet/bubbles/viewport`
- `charm.land/bubbles/v2/textarea` → `github.com/charmbracelet/bubbles/textarea`
- `charm.land/bubbles/v2/textinput` → `github.com/charmbracelet/bubbles/textinput`
- `charm.land/lipgloss/v2` → `github.com/charmbracelet/lipgloss`
- `charm.land/glamour/v2` → `github.com/charmbracelet/glamour`

**v1 API differences to account for:**
- `View()` returns `string` instead of `tea.View`
- `tea.KeyMsg` instead of `tea.KeyPressMsg`
- Key matching uses `msg.String()` or `msg.Type` instead of `msg.Code`
- Terminal features (alt screen, mouse) use `tea.WithAltScreen()` program option instead of View fields

**Step 3: Create entry point**

Create `tui/cmd/constellation-tui/main.go`:

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"constellation-tui/internal/protocol"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	backendCmd := exec.CommandContext(ctx, "bun", "run", "src/index.ts", "--interface", "jsonrpc")
	backendCmd.Dir = ".."
	backendCmd.Stderr = os.Stderr

	stdin, err := backendCmd.StdinPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create stdin pipe: %v\n", err)
		os.Exit(1)
	}

	stdout, err := backendCmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create stdout pipe: %v\n", err)
		os.Exit(1)
	}

	if err := backendCmd.Start(); err != nil {
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
		fmt.Fprintf(os.Stderr, "failed to receive ready notification: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "backend ready: protocol v%s, capabilities: %v\n",
		ready.ProtocolVersion, ready.Capabilities)

	client.Close()

	if err := backendCmd.Wait(); err != nil {
		fmt.Fprintf(os.Stderr, "backend exited: %v\n", err)
	}
}
```

**Step 4: Verify it compiles (will fail on missing internal/protocol — that's expected)**

```bash
cd tui && go build ./cmd/constellation-tui/ 2>&1 || echo "Expected: missing internal/protocol"
cd ..
```

**Commit:** `chore: initialise Go module and TUI entry point`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Go JSON-RPC client and transport

**Files:**
- Create: `tui/internal/protocol/types.go`
- Create: `tui/internal/protocol/transport.go`
- Create: `tui/internal/protocol/client.go`

**Step 1: Create protocol types**

Create `tui/internal/protocol/types.go`:

```go
package protocol

type ReadyParams struct {
	ProtocolVersion string   `json:"protocolVersion"`
	Capabilities    []string `json:"capabilities"`
}
```

**Step 2: Create stdio transport**

Create `tui/internal/protocol/transport.go`:

**IMPORTANT:** The TS backend writes line-delimited JSON (one JSON object per line, terminated by `\n`). Do NOT use `jsonrpc2.VSCodeObjectCodec{}` — that uses Content-Length header framing (LSP style) which is incompatible. Instead, implement a custom `ObjectCodec` that reads/writes newline-delimited JSON.

```go
package protocol

import (
	"bufio"
	"encoding/json"
	"io"

	"github.com/sourcegraph/jsonrpc2"
)

type stdioReadWriteCloser struct {
	reader io.ReadCloser
	writer io.WriteCloser
}

func newStdioReadWriteCloser(r io.ReadCloser, w io.WriteCloser) *stdioReadWriteCloser {
	return &stdioReadWriteCloser{reader: r, writer: w}
}

func (s *stdioReadWriteCloser) Read(p []byte) (int, error) {
	return s.reader.Read(p)
}

func (s *stdioReadWriteCloser) Write(p []byte) (int, error) {
	return s.writer.Write(p)
}

func (s *stdioReadWriteCloser) Close() error {
	rErr := s.reader.Close()
	wErr := s.writer.Close()
	if rErr != nil {
		return rErr
	}
	return wErr
}

// lineCodec implements jsonrpc2.ObjectCodec for newline-delimited JSON.
// Each message is a single JSON object followed by a newline character.
// This matches the TS backend's output format.
type lineCodec struct{}

func (lineCodec) WriteObject(stream io.Writer, obj interface{}) error {
	data, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stream.Write(data)
	return err
}

func (lineCodec) ReadObject(stream *bufio.Reader, v interface{}) error {
	line, err := stream.ReadBytes('\n')
	if err != nil {
		return err
	}
	return json.Unmarshal(line, v)
}

func newObjectStream(r io.ReadCloser, w io.WriteCloser) jsonrpc2.ObjectStream {
	rwc := newStdioReadWriteCloser(r, w)
	return jsonrpc2.NewBufferedStream(rwc, lineCodec{})
}
```

**Step 3: Create client**

Create `tui/internal/protocol/client.go`:

```go
package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"github.com/sourcegraph/jsonrpc2"
)

type Client struct {
	conn  *jsonrpc2.Conn
	mu    sync.Mutex
	ready chan ReadyParams
}

func NewClient(ctx context.Context, stdout io.ReadCloser, stdin io.WriteCloser) (*Client, error) {
	c := &Client{
		ready: make(chan ReadyParams, 1),
	}

	stream := newObjectStream(stdout, stdin)
	c.conn = jsonrpc2.NewConn(ctx, stream, c)

	return c, nil
}

func (c *Client) Handle(ctx context.Context, conn *jsonrpc2.Conn, req *jsonrpc2.Request) {
	if req.Notif {
		switch req.Method {
		case "ready":
			var params ReadyParams
			if req.Params != nil {
				if err := json.Unmarshal(*req.Params, &params); err != nil {
					fmt.Fprintf(io.Discard, "failed to unmarshal ready params: %v\n", err)
					return
				}
			}
			select {
			case c.ready <- params:
			default:
			}
		}
	}
}

func (c *Client) WaitReady(ctx context.Context) (ReadyParams, error) {
	select {
	case params := <-c.ready:
		return params, nil
	case <-ctx.Done():
		return ReadyParams{}, fmt.Errorf("context cancelled waiting for ready: %w", ctx.Err())
	}
}

func (c *Client) Call(ctx context.Context, method string, params any, result any) error {
	return c.conn.Call(ctx, method, params, result)
}

func (c *Client) Close() {
	c.conn.Close()
}
```

**Step 4: Verify Go code compiles**

```bash
cd tui && go build ./... && echo "Go build succeeded"
cd ..
```

Expected: Compiles without errors.

**Commit:** `feat: add Go JSON-RPC client and stdio transport`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify Go binary compiles end-to-end

**Step 1: Build the binary**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && echo "Binary built"
cd ..
```

Expected: Binary `tui/constellation-tui` exists.

**Step 2: Clean up binary (don't commit)**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-7) -->
<!-- START_TASK_4 -->
### Task 4: Add `jsonrpc` to InterfaceMode and config types

**Verifies:** bubbletea-tui.AC1.7 (stdout discipline requires knowing we're in jsonrpc mode)

**Files:**
- Modify: `src/config/types.ts:65` — add `'jsonrpc'` to InterfaceMode union
- Modify: `src/config/loader.ts` — ensure `'jsonrpc'` is accepted as a valid interface value

**Implementation:**

In `src/config/types.ts`, change the `InterfaceMode` type at line 65 from:

```typescript
export type InterfaceMode = 'tui' | 'discord' | 'both';
```

to:

```typescript
export type InterfaceMode = 'tui' | 'discord' | 'both' | 'jsonrpc';
```

In `src/config/loader.ts`, the existing validation at lines 149-151 explicitly checks `rawInterface === 'discord' || rawInterface === 'both'` and defaults everything else to `'tui'`. This will silently coerce `'jsonrpc'` set in config.toml to `'tui'`. **You MUST update this validation** to accept `'jsonrpc'`:

Change the validation from:
```typescript
const interfaceMode: InterfaceMode =
  rawInterface === 'discord' || rawInterface === 'both' ? rawInterface : 'tui';
```

to:
```typescript
const validModes: ReadonlyArray<string> = ['tui', 'discord', 'both', 'jsonrpc'];
const interfaceMode: InterfaceMode =
  validModes.includes(rawInterface) ? rawInterface as InterfaceMode : 'tui';
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat: add jsonrpc interface mode to config types`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Stdout discipline — redirect console output in jsonrpc mode

**Verifies:** bubbletea-tui.AC1.7

**Files:**
- Create: `src/jsonrpc/stdout-discipline.ts`
- Modify: `src/index.ts` — call stdout discipline setup early in jsonrpc mode

**Implementation:**

Create `src/jsonrpc/stdout-discipline.ts`:

```typescript
// pattern: Imperative Shell

export function enforceStdoutDiscipline(): void {
  const stderrWrite = process.stderr.write.bind(process.stderr);

  console.log = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.info = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.warn = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.debug = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };
}
```

In `src/index.ts`, add the following at the very top of the `main()` function, before any other code runs. The existing code reads config at around line 30-40 — check the exact location. The stdout discipline must be applied as early as possible after config is loaded:

```typescript
import { enforceStdoutDiscipline } from './jsonrpc/stdout-discipline.ts';

// Inside main(), after config is loaded but before anything else:
if (config.interface === 'jsonrpc') {
  enforceStdoutDiscipline();
}
```

Note: The existing `src/util/log.ts` already routes logging to stderr as a fallback. The stdout discipline function catches any stray `console.log` calls that bypass the `log()` utility.

**Limitation:** This does NOT intercept direct `process.stdout.write()` calls. Only the JSON-RPC server should write to stdout. Audit the codebase for any other direct `process.stdout.write()` calls that could corrupt the JSON-RPC stream. The existing codebase uses `log()` from `src/util/log.ts` for all logging, so this is low risk.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat: enforce stdout discipline in jsonrpc mode`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: JSON-RPC server and ready notification

**Verifies:** bubbletea-tui.AC1.1

**Files:**
- Create: `src/jsonrpc/types.ts`
- Create: `src/jsonrpc/server.ts`
- Create: `src/jsonrpc/notifications.ts`
- Create: `src/jsonrpc/handlers.ts`

**Implementation:**

Create `src/jsonrpc/types.ts`:

```typescript
// pattern: Functional Core

export type JsonRpcMessage = {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
};

export type JsonRpcError = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

export type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export type ReadyParams = {
  readonly protocolVersion: string;
  readonly capabilities: ReadonlyArray<string>;
};

export type MethodHandler = (
  params: Record<string, unknown> | undefined,
) => Promise<unknown>;
```

Create `src/jsonrpc/notifications.ts`:

```typescript
// pattern: Imperative Shell

import type { JsonRpcNotification } from './types.ts';

function sendNotification(method: string, params: Record<string, unknown>): void {
  const message: JsonRpcNotification = {
    jsonrpc: '2.0',
    method,
    params,
  };
  process.stdout.write(JSON.stringify(message) + '\n');
}

export function sendReady(): void {
  sendNotification('ready', {
    protocolVersion: '1',
    capabilities: ['sessions', 'chat', 'secrets', 'skills', 'customTools', 'schedules', 'prompt'],
  });
}
```

Create `src/jsonrpc/handlers.ts`:

```typescript
// pattern: Imperative Shell

import type { MethodHandler } from './types.ts';

export type JsonRpcDependencies = {
  // Will be populated in later phases as handlers are added
};

export function createHandlers(_deps: JsonRpcDependencies): Record<string, MethodHandler> {
  return {};
}
```

Create `src/jsonrpc/server.ts`:

```typescript
// pattern: Imperative Shell

import * as readline from 'readline';
import type { JsonRpcRequest, MethodHandler } from './types.ts';
import { sendReady } from './notifications.ts';

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendErrorResponse(id: number | string, code: number, message: string): void {
  sendResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

function isValidRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return (
    obj.jsonrpc === '2.0' &&
    typeof obj.method === 'string' &&
    (typeof obj.id === 'number' || typeof obj.id === 'string')
  );
}

export function startJsonRpcServer(handlers: Record<string, MethodHandler>): void {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendErrorResponse(0, -32700, 'Parse error');
      return;
    }

    if (!isValidRequest(parsed)) {
      sendErrorResponse(0, -32600, 'Invalid Request');
      return;
    }

    const handler = handlers[parsed.method];
    if (!handler) {
      sendErrorResponse(parsed.id, -32601, `Method not found: ${parsed.method}`);
      return;
    }

    try {
      const result = await handler(parsed.params as Record<string, unknown> | undefined);
      sendResponse({ jsonrpc: '2.0', id: parsed.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      sendErrorResponse(parsed.id, -32603, message);
    }
  });

  sendReady();
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat: add JSON-RPC server with ready notification`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Wire jsonrpc mode into index.ts startup

**Verifies:** bubbletea-tui.AC1.1

**Files:**
- Modify: `src/index.ts` — add jsonrpc mode branching alongside existing tui/discord branches

**Implementation:**

In `src/index.ts`, after the existing interface mode branching (around lines 151-187), add a new block for jsonrpc mode. Follow the same parallel-if pattern used by the existing modes:

```typescript
import { startJsonRpcServer } from './jsonrpc/server.ts';
import { createHandlers } from './jsonrpc/handlers.ts';
import type { JsonRpcDependencies } from './jsonrpc/handlers.ts';

// Add this block after the discord mode block (after line ~187):
if (mode === 'jsonrpc') {
  const jsonrpcDeps: JsonRpcDependencies = {};
  const handlers = createHandlers(jsonrpcDeps);
  startJsonRpcServer(handlers);
}
```

Note: The `enforceStdoutDiscipline()` call from Task 5 must execute before this block. Verify the ordering in the file.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

Then test the full flow manually:

```bash
echo '{"jsonrpc":"2.0","method":"nonexistent","id":1}' | bun run src/index.ts --interface jsonrpc 2>/dev/null | head -2
```

Expected output (two lines):
1. The `ready` notification: `{"jsonrpc":"2.0","method":"ready","params":{"protocolVersion":"1","capabilities":[...]}}`
2. A method-not-found error: `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found: nonexistent"}}`

**Commit:** `feat: wire jsonrpc interface mode into startup`

<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_8 -->
### Task 8: End-to-end verification — Go binary spawns backend and receives ready

**Step 1: Build Go binary**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/
```

Expected: Binary builds.

**Step 2: Run Go binary from tui/ directory**

```bash
cd tui && timeout 10 ./constellation-tui 2>&1 || true
```

Expected stderr output includes: `backend ready: protocol v1, capabilities: [sessions chat secrets skills customTools schedules prompt]`

The binary should exit after receiving the ready notification (it closes the connection, which causes the backend to exit).

**Step 3: Clean up**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_8 -->
