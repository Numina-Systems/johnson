# Bubbletea TUI Implementation Plan — Phase 3: Chat Core

**Goal:** Implement the chat screen with the hybrid pane layout and streaming agent events.

**Architecture:** The chat screen uses three independent bubbletea models: a viewport for message history, a status pane for live agent activity, and a textarea for input. Agent responses are rendered through glamour once on receipt and stored as pre-rendered strings. The TS backend adds `agent/chat` and `agent/reset` handlers that wire the existing `Agent.chat()` method's `onEvent` callback to JSON-RPC notifications. Events stream from the backend goroutine via `Program.Send()`.

**Tech Stack:** Go 1.26, bubbletea v2, bubbles v2 (viewport, textarea), lipgloss v2, glamour v2, TypeScript/Bun

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-05-09

---

## Acceptance Criteria Coverage

### bubbletea-tui.AC1: JSON-RPC protocol covers all TUI features
- **bubbletea-tui.AC1.3 Success:** `agent/chat` returns `requestId` immediately, then streams `agent/event` notifications, then sends `agent/response`

### bubbletea-tui.AC2: Go TUI implements all screens with hybrid layout
- **bubbletea-tui.AC2.1 Success:** Typing characters in the chat input shows no perceptible lag (sub-16ms per keystroke)
- **bubbletea-tui.AC2.2 Success:** Chat viewport scrolls through message history with keyboard (j/k or arrows)
- **bubbletea-tui.AC2.3 Success:** Status pane updates in real-time during agent processing (thinking, running code, round info)
- **bubbletea-tui.AC2.4 Success:** Agent responses render as formatted markdown (code blocks, bold, links) via glamour
- **bubbletea-tui.AC2.11 Edge:** Scrolling up in chat viewport triggers pagination to load older messages

### bubbletea-tui.AC3: TS backend exposes services over protocol
- **bubbletea-tui.AC3.2 Success:** `agent/chat` handler wires the existing `onEvent` callback to JSON-RPC notifications
- **bubbletea-tui.AC3.4 Edge:** Multiple concurrent requests (e.g., listing secrets while chat is running) are handled correctly

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: TS protocol types and notification emitters for chat

**Files:**
- Modify: `src/jsonrpc/types.ts` — add chat request/response and event notification types
- Modify: `src/jsonrpc/notifications.ts` — add `sendAgentEvent` and `sendAgentResponse` functions

**Implementation:**

Add to `src/jsonrpc/types.ts`:

```typescript
export type AgentChatParams = {
  readonly message: string;
  readonly sessionId: string;
};

export type AgentChatResult = {
  readonly requestId: string;
};

export type AgentResetResult = {
  readonly ok: boolean;
};

export type AgentEventNotification = {
  readonly requestId: string;
  readonly kind: 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done' | 'recall_done';
  readonly data: Record<string, unknown>;
};

export type AgentResponseNotification = {
  readonly requestId: string;
  readonly text: string;
  readonly stats: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly contextEstimate: number;
    readonly contextLimit: number;
    readonly rounds: number;
    readonly durationMs: number;
  };
};
```

Add to `src/jsonrpc/notifications.ts` — two new functions following the existing `sendNotification` pattern:

```typescript
export function sendAgentEvent(requestId: string, kind: string, data: Record<string, unknown>): void {
  sendNotification('agent/event', { requestId, kind, data });
}

export function sendAgentResponse(requestId: string, text: string, stats: Record<string, unknown>): void {
  sendNotification('agent/response', { requestId, text, stats });
}
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds.

**Commit:** `feat(jsonrpc): add chat protocol types and notification emitters`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: TS handlers for agent/chat and agent/reset

**Verifies:** bubbletea-tui.AC1.3, bubbletea-tui.AC3.2

**Files:**
- Modify: `src/jsonrpc/handlers.ts` — add `agent/chat` and `agent/reset` handlers, update `JsonRpcDependencies`

**Implementation:**

Update `JsonRpcDependencies` to include `agent` (type `Agent` from `src/agent/types.ts`).

Register two handlers:

**`agent/chat`:**
- Generate a `requestId` via `crypto.randomUUID()`
- Return `{ requestId }` immediately (this is the JSON-RPC response)
- After responding, call `agent.chat(params.message, { sessionId: params.sessionId, onEvent })` in a fire-and-forget pattern (don't await in the handler — the handler returns the requestId immediately, the chat runs in the background)
- The `onEvent` callback calls `sendAgentEvent(requestId, event.kind, event.data)` for each event
- When `agent.chat()` resolves, call `sendAgentResponse(requestId, result.text, result.stats)`
- If `agent.chat()` rejects, send an `agent/response` with the error text and zeroed stats

**`agent/reset`:**
- Call `agent.reset()` (synchronous)
- Return `{ ok: true }`

Update `src/index.ts` to pass `agent` (the TUI agent instance) into `JsonRpcDependencies`.

**Testing:**

Tests must verify:
- bubbletea-tui.AC1.3: `agent/chat` returns `requestId` immediately (handler returns before chat completes)
- bubbletea-tui.AC3.2: `onEvent` callback calls `sendAgentEvent` with correct requestId and event data
- bubbletea-tui.AC3.2: Chat completion calls `sendAgentResponse` with text and stats
- bubbletea-tui.AC3.4: Concurrent requests work — send `secret/list` while `agent/chat` is in-flight, verify `secret/list` response arrives before chat completes (mock agent.chat to delay ~100ms, send secret/list immediately after agent/chat, verify secret/list returns first)
- Edge: agent.chat() rejection sends error response notification

Create or extend `src/jsonrpc/handlers.test.ts`. Mock the Agent with a controllable `chat()` that resolves/rejects and fires events.

**Verification:**

```bash
bun test src/jsonrpc/
```

Expected: All tests pass.

**Commit:** `feat(jsonrpc): add agent/chat and agent/reset handlers`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Go protocol types for chat events

**Files:**
- Modify: `tui/internal/protocol/types.go` — add chat request/response and event types

**Implementation:**

Add to `tui/internal/protocol/types.go`:

```go
type AgentChatParams struct {
	Message   string `json:"message"`
	SessionID string `json:"sessionId"`
}

type AgentChatResult struct {
	RequestID string `json:"requestId"`
}

type AgentEventParams struct {
	RequestID string                 `json:"requestId"`
	Kind      string                 `json:"kind"`
	Data      map[string]interface{} `json:"data"`
}

type AgentResponseParams struct {
	RequestID string    `json:"requestId"`
	Text      string    `json:"text"`
	Stats     ChatStats `json:"stats"`
}

type ChatStats struct {
	InputTokens     int `json:"inputTokens"`
	OutputTokens    int `json:"outputTokens"`
	ContextEstimate int `json:"contextEstimate"`
	ContextLimit    int `json:"contextLimit"`
	Rounds          int `json:"rounds"`
	DurationMs      int `json:"durationMs"`
}
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add Go protocol types for chat events`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Go protocol client — handle agent event/response notifications and chat call

**Files:**
- Modify: `tui/internal/protocol/client.go` — add notification handlers for `agent/event` and `agent/response`, add `Chat` method

**Implementation:**

Extend the `Client.Handle()` method to dispatch `agent/event` and `agent/response` notifications. The client needs a way to forward these to the TUI — use callback fields:

Add to Client struct:
```go
type Client struct {
	conn          *jsonrpc2.Conn
	mu            sync.Mutex
	ready         chan ReadyParams
	onAgentEvent    func(AgentEventParams)
	onAgentResponse func(AgentResponseParams)
}
```

Add setter methods:
```go
func (c *Client) SetOnAgentEvent(fn func(AgentEventParams)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onAgentEvent = fn
}

func (c *Client) SetOnAgentResponse(fn func(AgentResponseParams)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onAgentResponse = fn
}
```

In `Handle()`, add cases for `agent/event` and `agent/response`:
- Parse params into the appropriate struct
- Call the callback if set

Add a `Chat` method:
```go
func (c *Client) Chat(ctx context.Context, message string, sessionID string) (AgentChatResult, error) {
	var result AgentChatResult
	err := c.Call(ctx, "agent/chat", AgentChatParams{
		Message:   message,
		SessionID: sessionID,
	}, &result)
	return result, err
}
```

Add a `Reset` method:
```go
func (c *Client) Reset(ctx context.Context) error {
	var result struct{ OK bool `json:"ok"` }
	return c.Call(ctx, "agent/reset", struct{}{}, &result)
}
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add chat and event handling to protocol client`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Go message renderer using glamour

**Files:**
- Create: `tui/internal/render/messages.go`

**Implementation:**

Create `tui/internal/render/messages.go`:

```go
package render

import (
	"fmt"
	"strings"

	"charm.land/glamour/v2"
	"charm.land/lipgloss/v2"
)

type Renderer struct {
	glamour *glamour.TermRenderer
	width   int
}

func NewRenderer(width int) (*Renderer, error) {
	r, err := glamour.NewTermRenderer(
		glamour.WithWordWrap(width - 4),
		glamour.WithStandardStyle("dark"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create glamour renderer: %w", err)
	}
	return &Renderer{glamour: r, width: width}, nil
}

func (r *Renderer) SetWidth(width int) error {
	renderer, err := glamour.NewTermRenderer(
		glamour.WithWordWrap(width - 4),
		glamour.WithStandardStyle("dark"),
	)
	if err != nil {
		return err
	}
	r.glamour = renderer
	r.width = width
	return nil
}

var userStyle = lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("#7D56F4"))

var agentStyle = lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("#04B575"))

func (r *Renderer) RenderUserMessage(content string) string {
	prefix := userStyle.Render("you> ")
	return prefix + content + "\n"
}

func (r *Renderer) RenderAgentMessage(content string) string {
	prefix := agentStyle.Render("agent> ")
	rendered, err := r.glamour.Render(content)
	if err != nil {
		return prefix + content + "\n"
	}
	rendered = strings.TrimRight(rendered, "\n")
	return prefix + rendered + "\n"
}
```

Run `go get charm.land/glamour/v2` in the `tui/` directory to add the dependency.

**Verification:**

```bash
cd tui && go get charm.land/glamour/v2 && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add glamour-based message renderer`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-8, with 7 split into 7a/7b/7c) -->
<!-- START_TASK_6 -->
### Task 6: Go layout helpers for vertical split-pane sizing

**Files:**
- Create: `tui/internal/layout/split.go`

**Implementation:**

Create `tui/internal/layout/split.go`:

```go
package layout

type ChatLayout struct {
	HeaderHeight int
	StatusHeight int
	InputHeight  int
	ViewportHeight int
	Width        int
}

func ComputeChatLayout(totalWidth, totalHeight, inputLines int) ChatLayout {
	headerHeight := 1
	statusHeight := 2
	inputHeight := inputLines + 1 // +1 for border
	if inputHeight > 4 {
		inputHeight = 4
	}

	borderLines := 3 // borders between panes
	viewportHeight := totalHeight - headerHeight - statusHeight - inputHeight - borderLines
	if viewportHeight < 3 {
		viewportHeight = 3
	}

	return ChatLayout{
		HeaderHeight:   headerHeight,
		StatusHeight:   statusHeight,
		InputHeight:    inputHeight,
		ViewportHeight: viewportHeight,
		Width:          totalWidth,
	}
}
```

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add chat layout helpers`

<!-- END_TASK_6 -->

<!-- START_TASK_7a -->
### Task 7a: Go chat screen — basic model with viewport, status pane, and textarea

**Files:**
- Create: `tui/internal/screens/chat.go`

**Implementation:**

Create `tui/internal/screens/chat.go` with the core chat model and layout:

Define `ChatModel` struct:
```go
type ChatModel struct {
	client    *protocol.Client
	sessionID string
	renderer  *render.Renderer

	viewport  viewport.Model    // scrollable message history
	textarea  textarea.Model    // multi-line input
	status    string            // current status text
	spinning  bool              // whether agent is processing

	messages      []renderedMessage  // pre-rendered message strings
	chatRequestID string             // current chat request ID (empty if idle)

	eventCh    chan protocol.AgentEventParams
	responseCh chan protocol.AgentResponseParams

	width  int
	height int
}

type renderedMessage struct {
	role     string  // "user" or "agent"
	rendered string  // pre-rendered string from glamour/lipgloss
}
```

**Init():** Returns a command to load message history via `session/messages` JSON-RPC call.

**Update():**
- `tea.WindowSizeMsg` — recompute layout via `layout.ComputeChatLayout`, resize viewport/textarea
- `tea.KeyPressMsg`:
  - `Enter` (without shift) — if textarea has content, send message:
    1. Get textarea value, reset textarea
    2. Render user message via `renderer.RenderUserMessage`
    3. Append to messages, update viewport content
    4. Return command to call `client.Chat()`
  - `Escape` — return navigation message to root model
  - `j/k` or `up/down` when viewport is focused — scroll viewport
  - All other keys — delegate to textarea
- Custom messages:
  - `messagesLoadedMsg` — render all loaded messages through the renderer, set viewport content
  - `chatStartedMsg` — store requestId, set status to "Thinking..."
  - `agentResponseMsg` — render agent response via `renderer.RenderAgentMessage`, append to messages, update viewport, clear status and requestId

**View():**
- Use lipgloss to compose: header → viewport → status pane → textarea
- Header: model name and session info (1 line, styled)
- Viewport: `viewport.View()` showing pre-rendered messages
- Status pane: current status text with optional spinner character (1-2 lines, bordered)
- Textarea: `textarea.View()` (fixed at bottom)

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add chat screen with basic layout`

<!-- END_TASK_7a -->

<!-- START_TASK_7b -->
### Task 7b: Go chat screen — event channel forwarding

**Files:**
- Modify: `tui/internal/screens/chat.go` — add event/response channel forwarding and status updates

**Implementation:**

Add the channel-based event forwarding system. The protocol client's `onAgentEvent` and `onAgentResponse` callbacks run on the JSON-RPC goroutine. They write to channels; a long-running `tea.Cmd` reads from the channels and returns bubbletea messages.

```go
func (m ChatModel) waitForEvent() tea.Cmd {
	return func() tea.Msg {
		select {
		case ev := <-m.eventCh:
			return agentEventMsg(ev)
		case resp := <-m.responseCh:
			return agentResponseMsg(resp)
		}
	}
}
```

After receiving each event message, return `waitForEvent()` again to keep listening. After receiving a response message, stop listening.

Add to Update():
- `agentEventMsg` — update status based on event kind:
  - `llm_start`: "Thinking... (round N)"
  - `llm_done`: "Round N complete"
  - `tool_start`: "Running code..."
  - `tool_done`: "Code finished" or "Code error"
  - `recall_done`: "Recalled N fragments"
  Then return `waitForEvent()` command to continue listening.

Register event/response callbacks on the protocol client when the chat model is created. The callbacks write to `eventCh` and `responseCh`.

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add event channel forwarding to chat screen`

<!-- END_TASK_7b -->

<!-- START_TASK_7c -->
### Task 7c: Go chat screen — scroll-up pagination

**Files:**
- Modify: `tui/internal/screens/chat.go` — add scroll-up pagination for older messages

**Implementation:**

Add scroll-up pagination:
- Track a `messageCursor` field on `ChatModel` (the cursor from the last `session/messages` response)
- When viewport reaches the top (offset 0) and the user scrolls up:
  - Check if `messageCursor` is non-empty
  - If yes, issue `session/messages` with the cursor via a tea.Cmd
  - On `loadOlderMsg` response: prepend older rendered messages to the messages list, update viewport content, adjust scroll position so the user's reading position doesn't jump

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): add scroll-up pagination to chat screen`

<!-- END_TASK_7c -->

<!-- START_TASK_8 -->
### Task 8: Wire chat screen into root model navigation

**Files:**
- Modify: `tui/internal/app/app.go` — add ChatModel to AppModel, wire screen transitions
- Modify: `tui/internal/screens/sessions.go` — on Enter, emit message to navigate to chat with session ID

**Implementation:**

In `app.go`:
- Add `chat *screens.ChatModel` field to AppModel
- When navigating to chat screen (from sessions Enter key), create a new `ChatModel` with the selected session ID and protocol client
- Route Update/View to chat model when `activeScreen == ScreenChat`
- Handle navigation messages from chat screen (Escape → pop to sessions)

In `sessions.go`:
- Define a `NavigateToChatMsg` custom message type: `type NavigateToChatMsg struct { SessionID string }`
- On Enter key with a selected session, return a command that sends `NavigateToChatMsg`
- The root model's Update catches this and creates/activates the chat screen

**Verification:**

```bash
cd tui && go build ./... && echo "Go build succeeded"
```

Expected: Compiles without errors.

**Commit:** `feat(tui): wire chat screen into navigation`

<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_9 -->
### Task 9: End-to-end verification — chat flow

**Step 1: Build and run**

```bash
cd tui && go build -o constellation-tui ./cmd/constellation-tui/ && ./constellation-tui
```

**Step 2: Verify chat flow**

1. Create or select a session from the sessions screen
2. Type a message and press Enter — should see "Thinking..." in status pane
3. Observe streaming status updates as agent processes
4. Agent response should appear rendered with markdown formatting (code blocks, bold, etc.)
5. Type another message — previous messages remain in viewport
6. Scroll up with j/k or arrow keys through message history
7. Press Escape to return to sessions screen

**Step 3: Verify keystroke performance**

Type rapidly in the input — characters should appear with no perceptible lag. The textarea model updates independently from the viewport.

**Step 4: Clean up**

```bash
rm -f tui/constellation-tui
```

**Commit:** No commit — verification only.

<!-- END_TASK_9 -->
