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

constellation-lite is a code-first AI agent. The model's primary (and only) tool is `execute_code`, which runs TypeScript in a sandboxed Deno subprocess. All other capabilities — documents, skills, search, scheduling — are implemented as a `tools.*` namespace injected into that sandbox, not as direct model tool calls.

### Dependency Wiring (`src/index.ts`)

`main()` is the imperative shell that wires everything together. It creates one shared instance of each service (model, runtime, store, embedding, scheduler), then calls `makeAgent()` per-interface. Discord gets one agent per channel; TUI gets one agent for the session.

### Agent Loop (`src/agent/agent.ts`)

Each `Agent` owns its own `history: Message[]`. The `chat()` function:
1. Regenerates TypeScript stubs for the Deno sandbox (`src/runtime/deno/tools.ts`) on every call
2. Builds a system prompt from persona + `self` document + skill names + tool docs
3. Runs a tool loop (up to `maxToolRounds`): model call → `execute_code` dispatch → tool result → repeat
4. Handles context overflow by calling `compactContext()` before the loop

### Sandbox IPC (`src/runtime/executor.ts`)

The Deno executor writes a temp `.ts` file, spawns `deno run` with capability flags, and communicates via line-delimited JSON on stdin/stdout. The sandbox's `output()` and `debug()` helpers emit `{"__output__": ...}` and `{"__debug__": ...}` lines; tool calls emit `{"__tool_call__": true, tool, params}` and read back `{"__tool_result__": ...}` or `{"__tool_error__": ...}` from stdin. Parent process API keys are never inherited — the sandbox env is minimal (`PATH`, `HOME`) plus any explicitly granted secrets.

`data/` is always `--deny-read` and `--deny-write` even in unrestricted mode, protecting grants and secrets from sandbox code.

### Tool Registry (`src/agent/tools.ts` + `src/runtime/tool-registry.ts`)

`createAgentTools()` registers all 8 built-in tools into a `ToolRegistry`. The registry also generates:
- TypeScript stub code (written to `src/runtime/deno/tools.ts`) so the sandbox can call `await tools.doc_upsert(...)` etc.
- Markdown documentation injected into the system prompt

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

### Grants System

Skills (`skill:*` documents) require human review before they can run with secrets. When `doc_upsert` writes a `skill:*` document, it auto-creates a `pending` grant keyed by SHA-256 of the content. If content changes, the grant is auto-revoked. The TUI's `/review` page lets the user grant/revoke skills and assign which vault secrets each skill can access. Secrets are stored in `data/grants.json` (never in SQLite).

### Scheduler (`src/scheduler/scheduler.ts`)

In-process cron via `croner`. Accepts cron expressions or human intervals (`6h`, `30m`, `1d`). Tasks persist to `data/tasks.json` and rehydrate on restart. When a task fires, a fresh agent session runs the prompt and delivers the response. Optional trigger guards (TypeScript code) run first — if they produce output, the prompt fires; if silent, the prompt is skipped.

### Configuration (`src/config/`)

`config.toml` is the single config file. `loadConfig()` accepts both `camelCase` and `snake_case` TOML keys (via the `pick()` helper). All API keys and base URLs can be overridden by environment variables. Embedding and Discord are optional — the agent starts normally if they're unavailable.

### Interfaces

- **TUI** (`src/tui/`): Ink/React terminal UI. Commands: `/reset`, `/review`, `/help`, `/quit`. The `/review` page (`ReviewPage.tsx`) is a full grant management interface for skills.
- **Discord** (`src/discord/bot.ts`): Per-channel agent instances. Responds to DMs unconditionally, guilds on mention or prefix. Splits long responses at 2000 chars.

## Key Patterns

Comments on source files identify the pattern used: `// pattern: Functional Core` (pure functions, no side effects) or `// pattern: Imperative Shell` (I/O, process spawning, side effects). Follow this convention when adding new modules.

Config types use `readonly` throughout — treat config as immutable after load.

Skills stored as `skill:*` documents include `// Skill: name` and `// Description: ...` header comments — these are parsed to show descriptions in the system prompt and review page.
