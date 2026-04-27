# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun start          # Run the agent (TUI by default)
bun run build      # Bundle to dist/ targeting Bun
bun test           # Run tests
```

No linter is configured. TypeScript strict mode is enforced via `tsconfig.json`.

## Architecture

constellation-lite is a code-first AI agent. The model's primary tool is `execute_code`, which runs TypeScript in a sandboxed Deno subprocess. Most capabilities — documents, skills, search, scheduling — are implemented as a `tools.*` namespace injected into that sandbox. Some tools (e.g. `view_image`, `summarize`) are also or exclusively available as native model tool calls, controlled by the `ToolMode` system (`sandbox`, `native`, or `both`).

### Dependency Wiring (`src/index.ts`)

`main()` is the imperative shell that wires everything together. It creates one shared instance of each service (model, runtime, store, embedding, scheduler), then calls `makeAgent()` per-interface. Discord gets one agent per channel; TUI gets one agent for the session.

### Agent Loop (`src/agent/agent.ts`)

Each `Agent` owns its own `history: Message[]`. The `chat()` function:
1. Regenerates TypeScript stubs for the Deno sandbox (`src/runtime/deno/tools.ts`) on every call
2. Builds a system prompt via `systemPromptProvider` callback (if set) with cached fallback, or inline from persona + `self` document + skill names + tool docs
3. Collects native tool definitions from the registry (tools with mode `native` or `both`)
4. Runs a tool loop (up to `maxToolRounds`): model call → dispatch (`execute_code` via sandbox IPC, native tools via registry) → tool result → repeat
5. Handles context overflow by calling `compactContext()` before the loop
6. Emits lifecycle events (`llm_start`, `llm_done`, `tool_start`, `tool_done`) via the `onEvent` callback in `ChatOptions`
7. Propagates `reasoning_content` from model responses onto assistant messages (extended thinking support)
8. On max-iteration exhaustion, forces a final text-only response (no tools) so the agent always replies
9. After each chat, fires `maybeGenerateSessionTitle()` (`src/agent/session-title.ts`) to auto-title sessions via the sub-agent

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
- **Custom Tools** (`custom-tool-manager.ts` + `custom-tools.ts`) — `create_custom_tool`, `list_custom_tools`, `call_custom_tool` (sandbox mode). User-created tools stored as `customtool:*` documents with hash-based approval, similar to the skill grant system.

### Persistent Store (`src/store/store.ts`)

Single SQLite database at `data/constellation.db` (via `bun:sqlite`). Stores documents (unified notes + skills) with FTS5 full-text search, embeddings (Float32 blobs), sessions/messages, scheduled tasks, and grants. WAL mode is always on.

### Documents & Memory

The agent's memory is a flat document store: `rkey → content`. Conventional rkey prefixes provide structure:
- `self` — agent identity (auto-loaded into system prompt every turn)
- `operator` — user preferences/context (fetched on demand)
- `skill:<name>` — reusable TypeScript skills
- `task:<name>` — task state
- `context/<timestamp>` — context compaction snapshots

The `self` document is auto-loaded via `loadCoreMemoryFromStore()` in `context.ts`. The `operator` document is intentionally NOT auto-loaded to save tokens.

Context compaction (`src/agent/compaction.ts`) triggers when token estimates exceed `contextBudget × contextLimit`. It saves the current conversation as a `context/<timestamp>` document, then rebuilds context from a summary of older context docs + the 3 most recent in full.

### Secrets Management (`src/secrets/manager.ts`)

`SecretManager` is a file-backed key-value store for API keys and credentials. It exposes `set()`, `remove()`, `listKeys()` (names only — never values to the agent), and `resolve()` (maps an array of key names to an env var dict for sandbox injection). Persisted to `data/secrets.json` with a serialized write queue.

### Grants System

Skills (`skill:*` documents) require human review before they can run with secrets. When `doc_upsert` writes a `skill:*` document, it auto-creates a `pending` grant keyed by SHA-256 of the content. If content changes, the grant is auto-revoked. The TUI's Tools screen lets the user grant/revoke skills and assign which vault secrets each skill can access. Custom tools (`customtool:*`) use a similar hash-based approval system via `CustomToolManager`.

### Sub-Agent LLM (`src/model/sub-agent.ts`)

`SubAgentLLM` is a lightweight single-shot completion interface used for utility tasks (context compaction, session titling, summarization) without consuming main-model tool rounds. Configured via the `[sub_model]` section in `config.toml`. Supports Anthropic, OpenAI-compat, OpenRouter, Ollama, and Lemonade providers. Falls back to wrapping the main `ModelProvider` (capped at 8k tokens) if no sub-model is configured.

### Scheduler (`src/scheduler/scheduler.ts`)

In-process cron via `croner`. Accepts cron expressions or human intervals (`6h`, `30m`, `1d`). Tasks persist to `data/tasks.json` and rehydrate on restart. When a task fires, a fresh agent session runs the prompt and delivers the response. Optional trigger guards (TypeScript code) run first — if they produce output, the prompt fires; if silent, the prompt is skipped.

### Configuration (`src/config/`)

`config.toml` is the single config file. `loadConfig()` accepts both `camelCase` and `snake_case` TOML keys (via the `pick()` helper). All API keys and base URLs can be overridden by environment variables. Embedding and Discord are optional — the agent starts normally if they're unavailable.

### Interfaces

- **TUI** (`src/tui/`): Ink/React terminal UI with stack-based navigation. `App.tsx` is the navigation shell routing between 6 screens in `src/tui/screens/`:
  - **Sessions** — list/create sessions (home screen)
  - **Chat** — conversation interface
  - **Tools** — manage skills, custom tools, and built-in tool listings (replaced the old `ReviewPage.tsx`)
  - **Secrets** — add/remove secrets via `SecretManager`
  - **Schedules** — view scheduled tasks
  - **SystemPrompt** — inspect the current system prompt
  Global navigation keybindings: `t` (tools), `s` (secrets), `c` (schedules), `p` (prompt), `Escape` (back), `q` (quit).
- **Discord** (`src/discord/bot.ts`): Per-channel agent instances. Responds to DMs unconditionally, guilds on mention or prefix. Splits long responses at 2000 chars.

## Key Patterns

Comments on source files identify the pattern used: `// pattern: Functional Core` (pure functions, no side effects) or `// pattern: Imperative Shell` (I/O, process spawning, side effects). Follow this convention when adding new modules.

Config types use `readonly` throughout — treat config as immutable after load.

Skills stored as `skill:*` documents include `// Skill: name` and `// Description: ...` header comments — these are parsed to show descriptions in the system prompt and Tools screen.
