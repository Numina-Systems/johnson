# Bubbletea TUI Frontend Design

## Summary

This design replaces the current terminal UI — built with Ink (a React renderer for the terminal) running inside the same Node/Bun process as the agent — with a Go binary that renders the UI using the Charm stack. The two processes communicate over a JSON-RPC 2.0 protocol on stdin/stdout: the Go TUI spawns the TypeScript backend as a child process and exchanges structured messages with it. The backend gains a thin `jsonrpc` interface mode that translates incoming requests into calls on already-existing services (Store, Agent, SecretManager, Scheduler) and pushes streaming agent events back as notifications. No business logic changes; the protocol is the only new seam.

The primary motivation is rendering performance and layout flexibility. The current Ink TUI cannot split the chat screen into independent panes without React re-rendering the whole tree on every keystroke. The Go TUI uses bubbletea's model-per-component architecture, so a keystroke in the input field updates only the textarea model — the message viewport and status pane are untouched. Agent responses are rendered through glamour once on receipt and stored as pre-rendered strings, not re-rendered on every update. A secondary benefit is that the JSON-RPC boundary is language-agnostic: a future Go backend rewrite would only require swapping the child process command, not the TUI.

## Definition of Done

Replace the current Ink/React TUI with a Go-based TUI frontend using bubbletea/bubbles/lipgloss/glamour that communicates with the existing TS backend over a JSON-RPC 2.0 protocol on stdin/stdout. The TUI spawns the backend as a child process. The protocol is language-agnostic so the backend can later be rewritten in Go without changing the TUI.

**Deliverables:**
1. A JSON-RPC 2.0 protocol specification covering all current TUI features: sessions, chat (with streaming events), tools/skills management, secrets, schedules, and system prompt inspection. Cursor-based pagination for message history.
2. A Go TUI binary using the Charm stack (bubbletea, bubbles, lipgloss, glamour) that implements all current screens with a hybrid layout — chat screen has split panes (history viewport + status/activity + input), other screens (sessions, tools, secrets, schedules, prompt) are full-screen switchable panels.
3. A thin JSON-RPC server layer in the TS backend that exposes the existing Store/Agent/SecretManager/Scheduler/CustomToolManager methods over the protocol.
4. Discord-only mode continues to work by running the backend directly without the TUI.

**Out of scope:**
- Rewriting the backend in Go (future work enabled by the protocol)
- The Claude Code integration (parked, depends on this landing first)
- New TUI features beyond parity + the pane layout improvement

## Acceptance Criteria

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.1 Success:** Backend starts in jsonrpc mode and emits `ready` notification with protocol version and capabilities
- **bubbletea-tui.AC1.2 Success:** All 20 request methods return well-formed JSON-RPC responses with correct data
- **bubbletea-tui.AC1.3 Success:** `agent/chat` returns `requestId` immediately, then streams `agent/event` notifications, then sends `agent/response`
- **bubbletea-tui.AC1.4 Success:** `session/messages` supports cursor-based pagination (returns next cursor when more messages exist, empty cursor at end)
- **bubbletea-tui.AC1.5 Failure:** Malformed JSON-RPC requests return standard error response (code -32600)
- **bubbletea-tui.AC1.6 Failure:** Unknown method returns method-not-found error (code -32601)
- **bubbletea-tui.AC1.7 Edge:** Only JSON-RPC messages appear on stdout in jsonrpc mode — no stray console.log output

### bubbletea-tui.AC2: Go TUI implements all screens with hybrid layout
- **bubbletea-tui.AC2.1 Success:** Typing characters in the chat input shows no perceptible lag (sub-16ms per keystroke)
- **bubbletea-tui.AC2.2 Success:** Chat viewport scrolls through message history with keyboard (j/k or arrows)
- **bubbletea-tui.AC2.3 Success:** Status pane updates in real-time during agent processing (thinking, running code, round info)
- **bubbletea-tui.AC2.4 Success:** Agent responses render as formatted markdown (code blocks, bold, links) via glamour
- **bubbletea-tui.AC2.5 Success:** Sessions screen lists sessions with message counts, supports create/delete
- **bubbletea-tui.AC2.6 Success:** Tools screen shows skills, custom tools, and builtins in tabbed view with grant/revoke/secret assignment
- **bubbletea-tui.AC2.7 Success:** Secrets screen lists secret names (never values), supports add/remove
- **bubbletea-tui.AC2.8 Success:** Schedules screen lists tasks with run counts and last-run info, supports enable/disable
- **bubbletea-tui.AC2.9 Success:** Prompt screen shows current system prompt in a scrollable viewport
- **bubbletea-tui.AC2.10 Success:** Screen navigation works via ctrl+ keybindings and escape to go back
- **bubbletea-tui.AC2.11 Edge:** Scrolling up in chat viewport triggers pagination to load older messages

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.1 Success:** JSON-RPC server translates requests to existing Store/Agent/SecretManager/Scheduler/CustomToolManager calls without modifying business logic
- **bubbletea-tui.AC3.2 Success:** `agent/chat` handler wires the existing `onEvent` callback to JSON-RPC notifications
- **bubbletea-tui.AC3.3 Failure:** Backend crash during chat sends broken-pipe signal that TUI detects and shows recovery UI
- **bubbletea-tui.AC3.4 Edge:** Multiple concurrent requests (e.g., listing secrets while chat is running) are handled correctly

### bubbletea-tui.AC4: Discord-only mode works independently
- **bubbletea-tui.AC4.1 Success:** `bun start --interface discord` starts Discord bot without requiring the Go TUI
- **bubbletea-tui.AC4.2 Success:** `constellation-tui --with-discord` starts both TUI and Discord in the same backend process
- **bubbletea-tui.AC4.3 Success:** TUI exit cleanly shuts down the backend (including Discord) via SIGTERM

## Glossary

- **bubbletea**: A Go framework for building terminal UIs using an Elm-inspired Model-Update-View architecture. Each UI component is a model with an `Update` function that handles messages and a `View` function that returns a string.
- **bubbles**: The standard-library component set for bubbletea — provides pre-built models for viewports (scrollable text regions), text areas, and list views used throughout this design.
- **lipgloss**: A Go library for terminal styling (colours, borders, padding) that works alongside bubbletea to control how rendered strings look.
- **glamour**: A Go library that renders Markdown to styled terminal output. Used here to render agent responses (code blocks, bold, lists) once on receipt.
- **Charm stack**: The collective name for bubbletea + bubbles + lipgloss + glamour, all maintained by Charm.sh.
- **JSON-RPC 2.0**: A stateless remote procedure call protocol encoded as JSON. Each request has a `method`, optional `params`, and an `id`; responses reference the same `id`. Notifications are one-way messages with no `id`.
- **sourcegraph/jsonrpc2**: The Go library used on the TUI side to implement the JSON-RPC 2.0 transport over the child process's stdin/stdout pipe.
- **line-delimited JSON**: A transport convention where each JSON message is a single line terminated by a newline, allowing a reader to parse messages by splitting on `\n` without a framing protocol.
- **notification (JSON-RPC)**: A JSON-RPC message sent without an `id`, meaning no response is expected. Used here for backend-to-TUI events like `agent/event` and `ready`.
- **cursor-based pagination**: A pagination strategy where the server returns an opaque cursor alongside each page; the client passes that cursor to fetch the next page. More stable than offset-based pagination when rows are being inserted.
- **Ink**: The React-based terminal UI framework the current TUI is built on. React's virtual DOM re-renders the component tree on every state change, which is the performance limitation being replaced.
- **bubbletea model-per-component**: The pattern where each screen or pane is an independent Go struct implementing the bubbletea `Model` interface, receiving only the messages it cares about. Contrasted with React's tree re-render.
- **stdout discipline**: The requirement that in `jsonrpc` mode the backend write *only* JSON-RPC messages to stdout. Any `console.log` output must be redirected to stderr, or the Go TUI will fail to parse the stream.
- **`ready` notification**: The first message the backend sends after startup, carrying `protocolVersion` and `capabilities`. The TUI blocks on this before issuing any requests.
- **Deno sandbox / sandbox IPC**: The existing mechanism by which the agent runs user-provided TypeScript in a Deno subprocess, communicating via line-delimited JSON on stdin/stdout. The JSON-RPC transport follows the same pattern at a higher level.
- **rkey**: Short for "record key" — the string identifier used to address documents in the flat document store (e.g. `skill:my-skill`, `self`, `operator`).
- **grant**: A permission record that allows a skill or custom tool to run with access to specific secrets. Skills require an explicit grant before they can execute; the Tools screen is where grants are managed.
- **hybrid layout**: The chat screen's specific arrangement: a scrollable message history viewport taking the majority of vertical space, a narrow status pane showing live agent activity, and a fixed input area at the bottom. Other screens use full-screen panels.
- **SIGTERM / SIGKILL**: Unix process signals. The TUI sends SIGTERM to the backend on exit (polite shutdown); SIGKILL is the fallback if the backend doesn't terminate within a timeout.

## Architecture

### Process Model

The Go TUI is the user-facing entry point. It spawns the TS backend as a child process and communicates over stdin/stdout using JSON-RPC 2.0 (line-delimited JSON, one message per line).

Three deployment modes:

- **TUI only:** `constellation-tui` spawns `bun run src/index.ts --interface jsonrpc`
- **Discord only:** `bun start --interface discord` — no Go TUI involved
- **Both:** `constellation-tui --with-discord` spawns backend with `--interface both` (jsonrpc + discord)

The TUI owns the backend's lifetime. On TUI exit, it sends SIGTERM to the child process. If the backend crashes, the TUI shows an error and offers to restart.

### JSON-RPC 2.0 Protocol

Transport is `sourcegraph/jsonrpc2` on the Go side and a custom line-delimited JSON server on the TS side, both operating over the child process's stdin/stdout.

Method namespace convention: `domain/action`.

**Requests (TUI → backend):**

| Method | Params | Response |
|--------|--------|----------|
| `session/list` | `{ limit?, cursor? }` | `{ sessions: SessionRow[], cursor? }` |
| `session/create` | `{ title? }` | `{ id }` |
| `session/delete` | `{ id }` | `{ ok }` |
| `session/messages` | `{ sessionId, limit?, cursor? }` | `{ messages: MessageRow[], cursor? }` |
| `agent/chat` | `{ message, sessionId }` | `{ requestId }` |
| `agent/reset` | `{}` | `{ ok }` |
| `secret/list` | `{}` | `{ keys: string[] }` |
| `secret/set` | `{ key, value }` | `{ ok }` |
| `secret/remove` | `{ key }` | `{ ok }` |
| `skill/list` | `{}` | `{ skills: SkillInfo[] }` |
| `skill/grant` | `{ rkey, status }` | `{ ok }` |
| `skill/updateSecrets` | `{ rkey, secrets: string[] }` | `{ ok }` |
| `skill/delete` | `{ rkey }` | `{ ok }` |
| `customTool/list` | `{}` | `{ tools: CustomToolInfo[] }` |
| `customTool/approve` | `{ name }` | `{ ok }` |
| `customTool/revoke` | `{ name }` | `{ ok }` |
| `customTool/updateSecrets` | `{ name, secrets: string[] }` | `{ ok }` |
| `schedule/list` | `{}` | `{ tasks: TaskState[] }` |
| `schedule/setEnabled` | `{ id, enabled }` | `{ ok }` |
| `prompt/get` | `{}` | `{ prompt: string }` |
| `grant/list` | `{}` | `{ grants: GrantRow[] }` |

**Notifications (backend → TUI):**

| Method | Params | When |
|--------|--------|------|
| `ready` | `{ protocolVersion, capabilities }` | Backend startup complete |
| `agent/event` | `{ requestId, kind, data }` | During chat: `llm_start`, `llm_done`, `tool_start`, `tool_done`, `recall_done` |
| `agent/response` | `{ requestId, text, stats }` | Chat complete |

The `agent/chat` request returns immediately with a `requestId`. Events and the final response arrive as notifications referencing that ID. This keeps the JSON-RPC channel responsive during multi-round agent processing.

**Stdout discipline:** The backend must redirect `console.log` to stderr on startup in jsonrpc mode. Only JSON-RPC messages may be written to stdout.

### Go TUI Component Architecture

Root model manages screen navigation via a stack, delegating to screen-specific models:

```
RootModel
  ├── protocol.Client          (JSON-RPC connection to backend)
  ├── activeScreen             (enum: sessions|chat|tools|secrets|schedules|prompt)
  ├── screenStack              (navigation history)
  ├── SessionsModel            (session list + selection)
  ├── ChatModel                (hybrid-layout screen)
  │     ├── viewport.Model     (scrollable message history)
  │     ├── statusPane         (thinking/tool status)
  │     └── textarea.Model     (multi-line input)
  ├── ToolsModel               (tabbed: skills / custom tools / builtins)
  ├── SecretsModel             (list + add/remove)
  ├── SchedulesModel           (list + enable/disable)
  └── PromptModel              (viewport showing system prompt)
```

### Chat Screen Hybrid Layout

```
┌──────────────────────────────────────────┐
│  constellation-lite — model-name         │  header (1 line)
├──────────────────────────────────────────┤
│                                          │
│  you> what's the weather like?           │
│                                          │  viewport (grows to fill)
│  agent> I'll check that for you.         │  scrollable, glamour-rendered
│  Let me search...                        │
│                                          │
├──────────────────────────────────────────┤
│  ⣾ Running code... (round 2)            │  status pane (1-2 lines)
├──────────────────────────────────────────┤
│  > type a message...                     │  input (fixed, grows to 3 lines)
└──────────────────────────────────────────┘
```

Each pane is an independent bubbletea model. A keystroke in the input only updates the textarea model — the viewport and status pane are untouched. Agent responses are rendered through glamour once on receipt and stored as pre-rendered strings in the viewport.

Global keybindings use ctrl+ prefix to avoid conflicts with text input: `ctrl+t` (tools), `ctrl+s` (secrets), `ctrl+d` (schedules), `ctrl+p` (prompt), `Esc` (back), `ctrl+c` (quit).

## Existing Patterns

### Backend Mode System

The existing `config.interface` field (`tui`, `discord`, `both`) and mode branching in `src/index.ts` (lines 151-187) provide the pattern for adding `jsonrpc` mode. Each mode creates its own agent instance and starts its interface non-destructively — multiple modes coexist in the same process.

### Event Callback Pattern

The `onEvent` callback in `ChatOptions` already defines the streaming event model. The JSON-RPC `agent/event` notifications are a direct serialization of the existing `AgentEvent` type (`llm_start`, `llm_done`, `tool_start`, `tool_done`, `recall_done` with `Record<string, unknown>` data).

### Dependency Injection

All TUI dependencies flow through a single `TuiDependencies` type. The JSON-RPC server layer follows the same pattern with a `JsonRpcDependencies` type containing `agent`, `store`, `secrets`, `scheduler`, `customTools`.

### Sandbox IPC

The Deno sandbox executor (`src/runtime/executor.ts`) already uses line-delimited JSON over stdin/stdout for tool call IPC. The JSON-RPC transport follows the same pattern at a higher level of abstraction.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Protocol Foundation

**Goal:** Establish the JSON-RPC transport between Go TUI and TS backend so they can exchange messages.

**Components:**
- Go module setup in `tui/` — `go.mod`, `cmd/constellation-tui/main.go`
- Go JSON-RPC client in `tui/internal/protocol/` — `client.go`, `transport.go`, `types.go`
- TS JSON-RPC server in `src/jsonrpc/` — `server.ts`, `handlers.ts`, `notifications.ts`, `types.ts`
- `jsonrpc` interface mode added to `src/config/types.ts` and `src/index.ts` startup branching
- Stdout discipline: redirect `console.log` to stderr in jsonrpc mode
- `ready` notification with protocol version and backend capabilities

**Dependencies:** None (first phase)

**Done when:** Go binary spawns the TS backend, receives the `ready` notification, and exits cleanly. TS backend starts in jsonrpc mode without errors.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Sessions & Navigation Shell

**Goal:** Build the Go TUI shell with screen navigation and the sessions screen.

**Components:**
- Root model in `tui/internal/app/app.go` — screen stack, global keybindings, message routing
- Sessions screen in `tui/internal/screens/sessions.go` — list, create, delete sessions
- TS handlers for `session/list`, `session/create`, `session/delete`, `session/messages` in `src/jsonrpc/handlers.ts`
- Protocol types for session operations in both Go (`tui/internal/protocol/types.go`) and TS (`src/jsonrpc/types.ts`)

**Dependencies:** Phase 1 (protocol foundation)

**Done when:** TUI displays session list, user can create/delete sessions, navigate with keyboard. Cursor-based pagination works for session messages. Tests verify handler responses match protocol types.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Chat Core

**Goal:** Implement the chat screen with the hybrid pane layout and streaming agent events.

**Components:**
- Chat screen in `tui/internal/screens/chat.go` — hybrid layout composing viewport, status pane, and textarea
- Layout helpers in `tui/internal/layout/split.go` — vertical split-pane sizing
- Message renderer in `tui/internal/render/messages.go` — glamour for agent responses, styled prefix for user messages
- TS handlers for `agent/chat`, `agent/reset` in `src/jsonrpc/handlers.ts`
- TS notification emitters for `agent/event`, `agent/response` in `src/jsonrpc/notifications.ts`
- Cursor-based message pagination on scroll-up in the viewport

**Dependencies:** Phase 2 (sessions + navigation)

**Done when:** User can type messages with no keystroke lag, send them, see streaming status updates (thinking, running code, round info), and receive glamour-rendered agent responses. Chat history loads with pagination on scroll-up. Tests verify the full chat request/event/response cycle over JSON-RPC.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Tools & Skills Management

**Goal:** Implement the tools screen with tabbed navigation for skills, custom tools, and builtins.

**Components:**
- Tools screen in `tui/internal/screens/tools.go` — tabbed view (skills, custom tools, builtins)
- TS handlers for `skill/list`, `skill/grant`, `skill/updateSecrets`, `skill/delete`, `customTool/list`, `customTool/approve`, `customTool/revoke`, `customTool/updateSecrets`, `grant/list` in `src/jsonrpc/handlers.ts`

**Dependencies:** Phase 2 (navigation shell)

**Done when:** User can view skills with grant status, grant/revoke skills, assign secrets to skills, delete skills. Custom tools can be approved/revoked with secret assignment. Builtin tools are listed. Tests verify each handler.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Secrets, Schedules & System Prompt

**Goal:** Implement remaining management screens.

**Components:**
- Secrets screen in `tui/internal/screens/secrets.go` — list, add, remove secrets
- Schedules screen in `tui/internal/screens/schedules.go` — list tasks, enable/disable
- Prompt screen in `tui/internal/screens/prompt.go` — viewport showing system prompt
- TS handlers for `secret/list`, `secret/set`, `secret/remove`, `schedule/list`, `schedule/setEnabled`, `prompt/get` in `src/jsonrpc/handlers.ts`

**Dependencies:** Phase 2 (navigation shell)

**Done when:** All three screens function with full feature parity to the current Ink TUI. Tests verify each handler.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Error Handling, Discord Integration & Polish

**Goal:** Production hardening and Discord coexistence.

**Components:**
- Backend crash detection and recovery UI in Go root model
- `--with-discord` flag in `cmd/constellation-tui/main.go` — passes `--interface both` to backend
- Process lifecycle management (SIGTERM on exit, SIGKILL fallback)
- Protocol version negotiation in the `ready` notification
- Build coordination — `Makefile` or `justfile` with targets for Go build, TS build, combined

**Dependencies:** Phases 3, 4, 5 (all screens complete)

**Done when:** TUI recovers gracefully from backend crashes. `--with-discord` starts both TUI and Discord. Clean shutdown on ctrl+c. Build scripts produce a working binary.
<!-- END_PHASE_6 -->

## Additional Considerations

**Protocol evolution:** The `ready` notification includes a `protocolVersion` field. If the protocol changes, the TUI can detect version mismatch and show a helpful error rather than failing cryptically. Start at version `1`.

**Ink TUI retention:** The existing Ink TUI (`src/tui/`) remains in the codebase during development. The `tui` interface mode continues to work. Once the Go TUI reaches parity and is validated, the Ink code can be removed in a follow-up.

**Future Go backend migration:** The protocol is the contract. When the backend is eventually rewritten in Go, the TUI binary doesn't change — only the child process command changes from `bun run src/index.ts` to the Go backend binary. The protocol types in `tui/internal/protocol/types.go` become shared types in a common Go package.
