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

`main()` is the imperative shell that wires everything together. It creates one shared instance of each service (model, runtime, store, embedding, scheduler), calls `seedSelfDoc(store)` to seed domain knowledge on first run, then calls `makeAgent()` per-interface. Discord gets one agent per channel; TUI gets one agent for the session. `workingDir` (from `process.cwd()`) is passed via `AgentDependencies` so tools can resolve workspace-relative paths safely.

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
- **Sessions** (`sessions.ts`) — `list_sessions`, `archive_session`, `delete_session` (sandbox mode). Session lifecycle management: list sessions with classification metadata, archive conversations to documents, or permanently delete sessions. Uses the session management domain (`src/sessions/`).

### Session Management (`src/sessions/`)

Handles session lifecycle: classification, archival, and pruning. Follows the Functional Core / Imperative Shell split.

- **Types** (`types.ts`) — Shared types: `SessionWithCounts`, `SessionClassification` (`'delete' | 'archive' | 'active'`), `ArchiveResult`, `PruneResult`.
- **Archive** (`archive.ts`) — Functional Core. Pure functions for session archival logic: `slugify()` (title to kebab-case), `buildArchiveRkey()` (format: `archive:session:<slug>:<datetime>`), `classifySession()` (delete if empty+>24h, archive if messages+>3d, else active), `formatArchiveDocument()` (markdown with YAML frontmatter + optional summary + transcript).
- **Archiver** (`archiver.ts`) — Imperative Shell. `archiveSession()` loads a session, optionally generates a summary via `SubAgentLLM`, formats the archive document, upserts it as a document, generates embeddings if available, then deletes the original session. `pruneSessions()` iterates all sessions, classifies each, and applies the appropriate action (delete/archive/skip).

Archive documents are stored with rkey prefix `archive:session:` (distinct from compaction's `archive:<timestamp>` prefix) and include YAML frontmatter with title, date range, and message count.

### Persistent Store (`src/store/store.ts`)

Single SQLite database at `data/constellation.db` (via `bun:sqlite`). Stores documents (unified notes + skills) with FTS5 full-text search, embeddings (Float32 blobs), sessions/messages, scheduled tasks, and grants. WAL mode is always on. `listSessionsWithCounts()` joins sessions with messages to return `SessionWithCounts` (id, title, timestamps, message count, last message time).

### Documents & Memory

The agent's memory is a flat document store: `rkey → content`. Conventional rkey prefixes provide structure:
- `self` — agent identity (auto-loaded into system prompt every turn)
- `operator` — user preferences/context (fetched on demand)
- `skill:<name>` — reusable TypeScript skills
- `customtool:<name>` — user-created custom tools (hash-based approval)
- `task:<name>` — task state
- `archive:<timestamp>` — context compaction snapshots
- `archive:session:<slug>:<datetime>` — archived conversation sessions (from session management)
- `ref:<name>` — reference documents (books, PDFs, etc.; migrated from `knowledge:*` and immutable)
- `ref:<name>:chunk:<i>` — chunked reference documents
- `knowledge:<name>` — semantic knowledge documents (user-ingested, mutable)
- `knowledge:<name>:chunk:<i>` — chunked knowledge documents
- `archivist:identity` — archivist identity document (seeded once on startup)
- `archivist:state` — archivist snapshot state (internal)
- `archivist:log` — append-only archivist run log
- `archivist:ref-migration` — marker for ref migration idempotency
- `index:*` — semantic indices (future)

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

### Archivist (`src/archivist/`)

Autonomous background knowledge maintenance subsystem that runs on a dual-schedule: daytime incremental cleanup (fast, targeted) and overnight full sweeps (comprehensive). The archivist deduplicates documents, resolves conflicts, and maintains coherence across the document store.

**Module Layout:**
- `index.ts` — Imperative Shell. Wires scheduler, manages daytime/nighttime cron jobs, calls `runPipeline()` and logs results.
- `types.ts` — Shared types: `Archivist`, `ArchivistDependencies`, `ArchivistSnapshot`, `ChangeSet`, `PipelineResult`, `BudgetTracker`, `PipelineMode`.
- `pipeline.ts` — Imperative Shell. Orchestrates the six-stage pipeline: scan → dedup → consolidate → crossref → prune → reflect. Each stage is wrapped via dependency injection. Enforces budget constraints and graceful degradation.
- `stages/` — Pipeline stages as Functional Core modules (`scan.ts`, `dedup.ts`, `consolidate.ts`, `crossref.ts`, `prune.ts`, `reflect.ts`). Pure functions that compute mutations given deps and snapshot state.
- `state.ts` — Functional Core. Manages snapshot checkpointing: `ArchivistSnapshot` (observations about docs) and `ChangeSet` (pending mutations). Computes mutations, filters mutable documents, and enforces immutability boundaries.
- `budget.ts` — Functional Core. Token budget tracking for embeddings and sub-agent calls. Prevents runaway costs.
- `seed.ts` — Imperative Shell. Marker-based idempotent seeding of `archivist:identity` document on first run. Called from `main()` before pipeline starts.
- `migration.ts` — Imperative Shell. Marker-based idempotent migration of reference books from `knowledge:*` to `ref:*` on first run. Called from `main()` after seed.
- `logging.ts` — Imperative Shell. Append-only run logs to `archivist:log` document.
- `similarity.ts` — Functional Core. Cosine similarity for deduplication. Vectorized via embeddings.

**Dual-Schedule System:**
- Daytime (configurable, e.g., `"0 9,12,15,18 * * *"`): Incremental mode. Scans recent modifications, deduplicates and consolidates changed documents, skips expensive crossref stage. Fast feedback loop.
- Nighttime (configurable, e.g., `"0 2 * * *"`): Full mode. Scans all documents, runs all six stages including crossref and reflection. Comprehensive cleanup.

**Six Pipeline Stages (in order):**
1. **Scan** — Enumerate documents from store, filter by mutable prefixes, build `ArchivistSnapshot` (hash, embedding, metadata for each).
2. **Dedup** — Find duplicate or near-duplicate documents via cosine similarity (requires embedding provider; skipped if unavailable). Return mutation set.
3. **Consolidate** — Merge redundant documents, preserve unique knowledge. Group by semantic similarity, compute summaries via sub-agent, create merged documents. Skipped if no sub-agent.
4. **Crossref** — Find related documents and inject cross-references. Expensive stage, runs only on full sweeps. Requires embedding and sub-agent.
5. **Prune** — Remove documents marked for deletion (e.g., empty, outdated, migrated). Apply all mutations.
6. **Reflect** — Introspective update to `self` and `operator` documents. Archivist notes patterns, archival counts, and memory health. Requires sub-agent. Skipped if unavailable.

**New rkey Prefixes:**
- `archivist:state` — Snapshot state during last run (for incremental detection).
- `archivist:identity` — Archivist identity document, seeded once, used as system prompt for all sub-agent calls.
- `archivist:log` — Append-only run log with statistics (token usage, duration, mutations applied).
- `archivist:ref-migration` — Marker document indicating ref migration has run (one-time idempotency).
- `index:*` — Future: semantic indices built by archivist (e.g., `index:by-topic`, `index:by-timeline`).
- `ref:*` — Reference documents (PDFs, books, etc.) migrated from `knowledge:*`. Immutable — archivist never modifies.

**Immutability Boundaries:**
The archivist respects three immutable prefixes and never modifies documents within them:
- `ref:*` — Reference materials (books, PDFs). Migrated once, updated only by ingest tool with `reference` intent.
- `skill:*` — Reusable skills. User-controlled, require grants.
- `customtool:*` — Custom tools. User-controlled, require hash-based approval.

All archivist mutations are marked with `<!-- archivist-managed -->` for identification.

**Graceful Degradation:**
- No embedding provider → Skip dedup and crossref stages, continue with scan/consolidate/prune/reflect.
- No sub-agent → Skip consolidate, reflect (requires summarization). Dedup, crossref (embedding-only) continue.
- Budget exhausted → Stop stage, move to next (don't fail the run).

### Configuration (`src/config/`)

`config.toml` is the single config file. `loadConfig()` accepts both `camelCase` and `snake_case` TOML keys (via the `pick()` helper). All API keys and base URLs can be overridden by environment variables. Embedding and Discord are optional — the agent starts normally if they're unavailable. Recall is configured under `[agent]`: `recallEnabled` (default `false`) and `recallTokenBudget` (default `1500`). `devMode` (default `false`) auto-approves skills and custom tools with all secrets — intended for development only.

### Reflexive Recall (`src/recall/`)

Automatic context retrieval pipeline that runs on each `chat()` call (when `recallEnabled` is true). Entry point: `performRecall(message, deps) → RecallResult | null`.

- **Orchestrator** (`index.ts`) — Imperative Shell. Guards: skips if message < 10 chars, no embedding provider, or empty store. Falls back gracefully: no SubAgentLLM uses raw message as query; LLM failure caught and falls back similarly.
- **Decomposition** (`decompose.ts` + `decompose-message.ts`) — Decomposes user message into semantic queries (1-4) and named entities via SubAgentLLM. Functional Core parses/validates JSON response; Imperative Shell handles LLM call.
- **Retrieval** (`retrieve.ts`) — Functional Core. Runs semantic queries via `hybridSearch` (up to 5 results per query) and entity FTS lookups (up to 3 per entity), deduplicates by rkey, filters to allowed prefixes (`knowledge:`, `skill:`, `archive:`), sorts by score, and trims to token budget. Returns `RecallResult`.

Recalled fragments are injected into the system prompt as a `## Recalled Context` section via `buildSystemPrompt()` in `src/agent/prompt.ts`, passed as the `recalledContext` field of `SystemPromptParams`.

### Interfaces

- **TUI** (`src/tui/`): Terminal UI using neo-blessed (Phase 1+). Entry point `startTUI(deps: TuiDependencies)` creates a blessed screen with tab-bar navigation. Key modules:
  - `index.ts` — Imperative Shell. Creates blessed screen, tab bar, and screen-level key bindings (Tab/S-Tab for tab cycling, Escape to Sessions, q/C-c to quit).
  - `types.ts` — Functional Core. Exports `ScreenView` contract, `TuiEvents` typing, and `TuiDependencies`.
  - `theme.ts` — Functional Core. Catppuccin Macchiato palette (hex strings) and `blessedStyles` (blessed-compatible style objects).
  - `tab-bar.ts` — Imperative Shell. Blessed box widget for horizontal tab rendering with activity indicators. Supports mouse clicks and keyboard navigation.
  - `screens/` — Phase 3+ implementations. Will contain `ScreenView` implementations for Sessions, Chat, Tools, Secrets, Schedules, SystemPrompt, Prune tabs.
- **Discord** (`src/discord/bot.ts`): Per-channel agent instances. Responds to DMs unconditionally, guilds on mention or prefix. Splits long responses at 2000 chars.

## Key Patterns

Comments on source files identify the pattern used: `// pattern: Functional Core` (pure functions, no side effects) or `// pattern: Imperative Shell` (I/O, process spawning, side effects). Follow this convention when adding new modules.

Config types use `readonly` throughout — treat config as immutable after load.

Skills stored as `skill:*` documents include `// Skill: name` and `// Description: ...` header comments — these are parsed to show descriptions in the system prompt and Tools screen.
