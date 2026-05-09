# JSON-RPC Interface

Last verified: 2026-05-09

## Purpose

Provides a process-boundary API for external frontends (the Go TUI) to interact with the agent, store, and management services. Reserves stdout exclusively for JSON-RPC messages so the transport stays clean.

## Contracts

- **Exposes**: 21 RPC methods across 8 namespaces, plus 3 server-to-client notifications
- **Guarantees**: Line-delimited JSON-RPC 2.0 on stdin (requests) / stdout (responses + notifications). Emits `ready` notification with `protocolVersion: "1"` and capability list on startup. `agent/chat` is fire-and-forget: returns `requestId` immediately, delivers results via `agent/response` notification.
- **Expects**: One JSON object per line. Requests must include `id` (notifications without `id` are silently discarded). `agent/chat` requires both `message` and `sessionId`.

## RPC Methods

| Namespace | Methods |
|-----------|---------|
| session | `list`, `create`, `delete`, `messages` |
| agent | `chat`, `reset` |
| skill | `list`, `grant`, `updateSecrets`, `delete` |
| customTool | `list`, `approve`, `revoke`, `updateSecrets` |
| grant | `list` |
| builtin | `list` |
| secret | `list`, `set`, `remove` |
| schedule | `list`, `setEnabled` |
| prompt | `get` |

## Server-to-Client Notifications

| Method | When |
|--------|------|
| `ready` | Backend startup complete |
| `agent/event` | Agent lifecycle events (llm_start, llm_done, tool_start, tool_done, recall_done) |
| `agent/response` | Chat response with text and token stats |

## Dependencies

- **Uses**: `Store` (sessions, documents, grants), `Agent` (chat, reset), `CustomToolManager`, `SecretManager`, `TaskStore` (scheduler)
- **Used by**: Go TUI (`tui/internal/protocol/client.go`)
- **Boundary**: Handlers are thin wrappers -- business logic stays in the domain modules

## Key Files

- `types.ts` -- All request/response types (Functional Core)
- `handlers.ts` -- Handler factory, receives `JsonRpcDependencies` (Imperative Shell)
- `server.ts` -- stdin readline loop, dispatch, error responses (Imperative Shell)
- `notifications.ts` -- `sendReady`, `sendAgentEvent`, `sendAgentResponse` (Imperative Shell)
- `stdout-discipline.ts` -- Redirects console.* to stderr (Imperative Shell)

## Invariants

- Stdout must contain only JSON-RPC messages -- `enforceStdoutDiscipline()` must run before any handler or agent code
- Handlers are conditionally registered based on which dependencies are provided (e.g., no `agent` = no `agent/chat` handler)
- Error responses use standard JSON-RPC error codes: -32700 (parse), -32600 (invalid request), -32601 (method not found), -32603 (internal)
