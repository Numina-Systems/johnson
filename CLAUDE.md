# CLAUDE.md

Last verified: 2026-05-09

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full project (requires just)
just build         # Build TS backend + Go TUI
just test          # Run all tests (TS + Go)
just dev           # Run Go TUI in dev mode (no build)
just dev-discord   # Run Go TUI + Discord bot
just discord       # Run Discord-only (no TUI)
just clean         # Remove dist/ and bin/
just fmt           # Format Go code

# TypeScript backend only
bun run build      # Bundle to dist/ targeting Bun
bun test           # Run TS tests
bun run src/index.ts --interface jsonrpc  # Run backend in JSON-RPC mode

# Go TUI only (from tui/)
go build -o ../bin/constellation-tui ./cmd/constellation-tui/
go test ./...
```

No linter is configured. TypeScript strict mode is enforced via `tsconfig.json`.

## Architecture

constellation-lite is a code-first AI agent. The model's primary tool is `execute_code`, which runs TypeScript in a sandboxed Deno subprocess. Most capabilities — documents, skills, search, scheduling — are implemented as a `tools.*` namespace injected into that sandbox. Some tools (e.g. `view_image`, `summarize`) are also or exclusively available as native model tool calls, controlled by the `ToolMode` system (`sandbox`, `native`, or `both`).

### Dependency Wiring (`src/index.ts`)

`main()` is the imperative shell that wires everything together. It creates one shared instance of each service (model, runtime, store, embedding, scheduler), calls `seedSelfDoc(store)` to seed domain knowledge on first run, then creates per-interface agents. The `--interface` CLI flag (parsed by `src/config/cli.ts`) selects the mode: `tui` (legacy Ink), `jsonrpc` (Go TUI backend), `discord`, or `both` (jsonrpc + discord). Each interface gets its own `Agent` instance with independent in-memory history. Discord gets one shared agent per channel; JSON-RPC and TUI each get a dedicated agent. `workingDir` (from `process.cwd()`) is passed via `AgentDependencies` so tools can resolve workspace-relative paths safely.

In `jsonrpc` or `both` mode, `enforceStdoutDiscipline()` redirects all `console.log/info/warn/debug` to stderr before any output, reserving stdout exclusively for JSON-RPC messages.

### Agent Loop (`src/agent/agent.ts`)

Each `Agent` owns its own `history: Message[]`. The `chat()` function:
1. Regenerates TypeScript stubs for the Deno sandbox (`src/runtime/deno/tools.ts`) on every call
2. Collects native tool definitions from the registry (tools with mode `native` or `both`)
3. Handles context overflow by calling `compactContext()` before the tool loop
4. Runs reflexive recall (if `recallEnabled`) to retrieve relevant knowledge fragments, emitting `recall_done`
5. Builds the system prompt by calling `buildSystemPrompt()` from `src/agent/prompt.ts` directly with a `SystemPromptParams` object (self doc, skill names, tool docs, timezone, recalled context, custom tool summaries, secret names)
6. Runs a tool loop (up to `maxToolRounds`): model call → dispatch (`execute_code` via sandbox IPC, native tools via registry) → tool result → repeat
7. Emits lifecycle events (`llm_start`, `llm_done`, `tool_start`, `tool_done`, `recall_done`) via the `onEvent` callback in `ChatOptions`
8. Propagates `reasoning_content` from model responses onto assistant messages (extended thinking support)
9. On max-iteration exhaustion, forces a final text-only response (no tools) so the agent always replies
10. After each chat, fires `maybeGenerateSessionTitle()` (`src/agent/session-title.ts`) to auto-title sessions via the sub-agent

### System Prompt Builder (`src/agent/prompt.ts`)

Functional Core module that assembles the system prompt from template constants and a `SystemPromptParams` input. Replaces the old `buildSystemPrompt()` that lived in `context.ts` and the `systemPromptProvider` callback pattern. The persona content that previously lived in `persona.md` is now split: static instructional sections (tool calling, documents, chaining, error handling) are template constants in this module; domain knowledge (identity, obsidian vault, skills, scheduling) is seeded into the `self` document via `seed-self-doc.ts`.

Exported: `buildSystemPrompt(params: SystemPromptParams) → string` and the `SystemPromptParams` type.

### Self-Doc Seeding (`src/agent/seed-self-doc.ts`)

Imperative Shell module that runs once at startup via `seedSelfDoc(store)`. Checks whether the `self` document already contains a `<!-- seeded-from-persona -->` marker. If not, appends domain knowledge content (identity, obsidian vault conventions, skills, scheduling, file ingestion) to the existing `self` document. This is a one-time migration — subsequent runs are no-ops.

### Sandbox IPC (`src/runtime/executor.ts`)

The Deno executor writes a temp `.ts` file, spawns `deno run` with capability flags, and communicates via line-delimited JSON on stdin/stdout. The sandbox's `output()` and `debug()` helpers emit `{"__output__": ...}` and `{"__debug__": ...}` lines; tool calls emit `{"__tool_call__": true, tool, params}` and read back `{"__tool_result__": ...}` or `{"__tool_error__": ...}` from stdin. Parent process API keys are never inherited — the sandbox env is minimal (`PATH`, `HOME`) plus any explicitly granted secrets.

`data/` is always `--deny-read` and `--deny-write` even in unrestricted mode, protecting grants and secrets from sandbox code.

### Tool Registry (`src/agent/tools.ts` + `src/runtime/tool-registry.ts`)

`createAgentTools()` registers all tools into a `ToolRegistry`. Each tool has a `ToolMode`:
- `sandbox` — callable only via `execute_code` (generates Deno stubs + prompt docs)
- `native` — callable only as a direct model tool call (generates `ToolDefinition` for the model, no sandbox stub)
- `both` — available through either path

The registry generates:
- TypeScript stub code (written to `src/runtime/deno/tools.ts`) for `sandbox` and `both` tools
- `ToolDefinition[]` for `native` and `both` tools, passed alongside `execute_code` in the model request
- Markdown documentation injected into the system prompt (all modes, with mode annotation)

### Tool Modules (`src/tools/`)

Tools are organized into domain-specific modules under `src/tools/`, each exporting a `register*Tools()` function called from `createAgentTools()`:

- **Web** (`web.ts`) — `web_search`, `fetch_page`, `http_get` (sandbox mode, Exa AI integration). Requires `EXA_API_KEY` secret.
- **Notify** (`notify.ts`) — `notify_discord` (sandbox mode, Discord webhook). Requires `DISCORD_WEBHOOK_URL` secret.
- **Image** (`image.ts`) — `view_image` (native mode). Fetches a URL and returns a base64 `ImageSourceBlock` so the model can see the image.
- **Summarize** (`summarize.ts`) — `summarize` (both mode). Delegates to the sub-agent LLM. Requires `[sub_model]` config.
- **Ingest** (`ingest.ts` + `chunking.ts`) — `ingest_file` (native mode). Reads workspace files and routes by intent: `memory` (appends to `self`), `knowledge` (stores as documents with semantic chunking), `context` (returns content inline). Large files are chunked via `chunking.ts` (Functional Core) and summarised via `SubAgentLLM`. Security: resolves paths relative to `workingDir`, blocks traversal above workspace root, rejects binary files and files >1MB. Only registered when `deps.workingDir` is set.
- **Custom Tools** (`custom-tool-manager.ts` + `custom-tools.ts`) — `create_custom_tool`, `list_custom_tools`, `call_custom_tool` (sandbox mode). User-created tools stored as `customtool:*` documents with hash-based approval, similar to the skill grant system.

### Persistent Store (`src/store/store.ts`)

Single SQLite database at `data/constellation.db` (via `bun:sqlite`). Stores documents (unified notes + skills) with FTS5 full-text search, embeddings (Float32 blobs), sessions/messages, scheduled tasks, and grants. WAL mode is always on.

The store exposes cursor-based pagination for sessions (`listSessionsPaginated`) and messages (`getMessagesPaginated`), used by JSON-RPC handlers. Session cursors encode `updated_at|id` (keyset pagination, DESC order); message cursors encode the last `id` (ASC order). Both fetch `limit + 1` rows to detect whether a next page exists.

### Documents & Memory

The agent's memory is a flat document store: `rkey → content`. Conventional rkey prefixes provide structure:
- `self` — agent identity (auto-loaded into system prompt every turn)
- `operator` — user preferences/context (fetched on demand)
- `skill:<name>` — reusable TypeScript skills
- `task:<name>` — task state
- `archive:<timestamp>` — context compaction snapshots

The `self` document is auto-loaded each turn: `agent.ts` reads it via `store.docGet('self')` and passes it to `buildSystemPrompt()` as the `selfDoc` parameter. On first run, `seedSelfDoc()` populates it with domain knowledge migrated from the former `persona.md`. The `operator` document is intentionally NOT auto-loaded to save tokens.

Context compaction (`src/agent/compaction.ts`) triggers when token estimates exceed `contextBudget × contextLimit`. It saves the current conversation as an `archive:<timestamp>` document, then rebuilds context from a summary of older context docs + the 3 most recent in full.

### Secrets Management (`src/secrets/manager.ts`)

`SecretManager` is a file-backed key-value store for API keys and credentials. It exposes `set()`, `remove()`, `listKeys()` (names only — never values to the agent), and `resolve()` (maps an array of key names to an env var dict for sandbox injection). Persisted to `data/secrets.json` with a serialized write queue.

### Grants System

Skills (`skill:*` documents) require human review before they can run with secrets. When `doc_upsert` writes a `skill:*` document, it auto-creates a `pending` grant keyed by SHA-256 of the content. If content changes, the grant is auto-revoked. The TUI's Tools screen lets the user grant/revoke skills and assign which vault secrets each skill can access. Custom tools (`customtool:*`) use a similar hash-based approval system via `CustomToolManager`.

### Sub-Agent LLM (`src/model/sub-agent.ts`)

`SubAgentLLM` is a lightweight single-shot completion interface used for utility tasks (context compaction, session titling, summarization) without consuming main-model tool rounds. Configured via the `[sub_model]` section in `config.toml`. Supports Anthropic, OpenAI-compat, OpenRouter, Ollama, and Lemonade providers. Falls back to wrapping the main `ModelProvider` (capped at 8k tokens) if no sub-model is configured.

### Scheduler (`src/scheduler/scheduler.ts`)

In-process cron via `croner`. Accepts cron expressions or human intervals (`6h`, `30m`, `1d`). Tasks persist to `data/tasks.json` and rehydrate on restart. When a task fires, a fresh agent session runs the prompt and delivers the response. Optional trigger guards (TypeScript code) run first — if they produce output, the prompt fires; if silent, the prompt is skipped.

### Configuration (`src/config/`)

`config.toml` is the single config file. `loadConfig()` accepts both `camelCase` and `snake_case` TOML keys (via the `pick()` helper). All API keys and base URLs can be overridden by environment variables. Embedding and Discord are optional — the agent starts normally if they're unavailable. Recall is configured under `[agent]`: `recallEnabled` (default `false`) and `recallTokenBudget` (default `1500`). `devMode` (default `false`) auto-approves skills and custom tools with all secrets — intended for development only.

`InterfaceMode` is `'tui' | 'discord' | 'both' | 'jsonrpc'`. The `--interface <mode>` CLI flag overrides the config file value. `'both'` means `jsonrpc + discord` (the Go TUI spawns the backend in `both` mode via `--with-discord`). The legacy Ink TUI uses `'tui'` mode directly.

### Reflexive Recall (`src/recall/`)

Automatic context retrieval pipeline that runs on each `chat()` call (when `recallEnabled` is true). Entry point: `performRecall(message, deps) → RecallResult | null`.

- **Orchestrator** (`index.ts`) — Imperative Shell. Guards: skips if message < 10 chars, no embedding provider, or empty store. Falls back gracefully: no SubAgentLLM uses raw message as query; LLM failure caught and falls back similarly.
- **Decomposition** (`decompose.ts` + `decompose-message.ts`) — Decomposes user message into semantic queries (1-4) and named entities via SubAgentLLM. Functional Core parses/validates JSON response; Imperative Shell handles LLM call.
- **Retrieval** (`retrieve.ts`) — Functional Core. Runs semantic queries via `hybridSearch` (up to 5 results per query) and entity FTS lookups (up to 3 per entity), deduplicates by rkey, filters to allowed prefixes (`knowledge:`, `skill:`, `archive:`), sorts by score, and trims to token budget. Returns `RecallResult`.

Recalled fragments are injected into the system prompt as a `## Recalled Context` section via `buildSystemPrompt()` in `src/agent/prompt.ts`, passed as the `recalledContext` field of `SystemPromptParams`.

### Interfaces

- **Go TUI** (`tui/`): Bubble Tea terminal UI that communicates with the TS backend over JSON-RPC 2.0 via stdin/stdout. The Go binary spawns the TS backend as a child process (`bun run src/index.ts --interface jsonrpc`), waits for a `ready` notification, then drives all interaction through RPC calls. See `tui/CLAUDE.md` for architecture details. Same 6-screen layout as the legacy TUI: Sessions, Chat, Tools, Secrets, Schedules, SystemPrompt. Global keybindings: `ctrl+t` (tools), `ctrl+s` (secrets), `ctrl+d` (schedules), `ctrl+p` (prompt), `escape` (back), `ctrl+c` (quit). Discord coexistence: `--with-discord` flag spawns the backend in `both` mode.
- **JSON-RPC Backend** (`src/jsonrpc/`): Line-delimited JSON-RPC 2.0 server on stdin/stdout, used by the Go TUI. Provides 21 handlers across 8 namespaces: session, agent, skill, customTool, grant, builtin, secret, schedule, prompt. See `src/jsonrpc/CLAUDE.md` for the protocol contract.
- **Legacy TUI** (`src/tui/`): Ink/React terminal UI, still functional via `--interface tui`. Stack-based navigation with 6 screens. Global navigation keybindings: `t` (tools), `s` (secrets), `c` (schedules), `p` (prompt), `Escape` (back), `q` (quit).
- **Discord** (`src/discord/bot.ts`): Per-channel agent instances. Responds to DMs unconditionally, guilds on mention or prefix. Splits long responses at 2000 chars.

## Key Patterns

Comments on source files identify the pattern used: `// pattern: Functional Core` (pure functions, no side effects) or `// pattern: Imperative Shell` (I/O, process spawning, side effects). Follow this convention when adding new modules.

Config types use `readonly` throughout — treat config as immutable after load.

Skills stored as `skill:*` documents include `// Skill: name` and `// Description: ...` header comments — these are parsed to show descriptions in the system prompt and Tools screen.
