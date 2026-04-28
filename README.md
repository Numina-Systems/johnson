# Johnson

An AI agent harness with a TUI and an optional Discord interface, built around a single premise: the agent has one callable tool—`execute_code`—and writes everything else as code on your behalf. While it started in a different place, the architecture borrows from [Victrola](https://github.com/haileyok/victrola) at this point.

Why Johnson? Because I thought it would be very amusing to say things like "Johnson, get me the Danforth file" or "Johnson, take this down".

> [!WARNING]
> Tools run in a Deno sandbox. This offers reasonable isolation, but not a security guarantee. Exercise judgement.

## TUI

The terminal UI has six screens, navigable via global keyboard shortcuts:

| Key | Screen | Description |
|-----|--------|-------------|
| — | **Sessions** | List, create, and delete sessions (home screen) |
| — | **Chat** | Conversation interface with event-driven status indicators |
| `t` | **Tools** | Manage skills, custom tools, and view built-in tool listings |
| `s` | **Secrets** | Add/remove API keys and credentials |
| `c` | **Schedules** | View and toggle scheduled tasks |
| `p` | **System Prompt** | Inspect the current system prompt (read-only, scrollable) |

`Escape` goes back, `q` quits. Chat-screen slash commands: `/reset`, `/help`, `/quit`.

## Tools

The agent exposes tools across seven categories. Each tool has a mode: **sandbox** (callable via `execute_code`), **native** (direct model tool call), or **both**.

### Code Execution

| Tool | Mode | Description |
|------|------|-------------|
| `execute_code` | native | Run TypeScript in the Deno sandbox. The primary callable function. |

### Documents

All agent memory is stored as documents, each identified by an `rkey` and containing free-form `content`. This unified document store — rather than separate subsystems for notes, skills, and context — means the agent's memory is searchable, versioned, and inspectable in one place.

| Tool | Mode | Description |
|------|------|-------------|
| `doc_upsert` | sandbox | Create or update a document by rkey. For `skill:*` rkeys, auto-manages grants. |
| `doc_get` | sandbox | Read one or more documents by rkey (batch reads supported). |
| `doc_list` | sandbox | List all documents with short content previews. |
| `doc_search` | sandbox | Full-text search across all documents. |

#### Conventional rkeys

| Prefix | Purpose | Auto-loaded? |
|--------|---------|-------------|
| `self` | Agent identity, behavior notes | ✅ Yes — injected into system prompt every turn |
| `operator` | Compact user profile — key facts and pointers to `ref:*` docs | ❌ No — agent fetches on demand |
| `ref:<topic>` | Detailed reference material (vault structure, protocols, etc.) | ❌ No — fetched when `operator` points to them |
| `skill:<name>` | Reusable TypeScript skills | Names listed in system prompt |
| `task:<name>` | Long-running task state | ❌ No |
| `context/<ts>` | Context compaction snapshots | Used internally |
| *(anything else)* | Free-form notes, facts, reminders | ❌ No |

### Skills

| Tool | Mode | Description |
|------|------|-------------|
| `run_skill` | sandbox | Execute an approved `skill:*` document. Args passed as an array (spaces preserved). |

Skills require human approval before they may run with secrets. When a skill is created or modified, it enters a "pending" state; the operator reviews the code, grants access, and assigns secrets through the **Tools** screen (`t`) in the TUI.

### Custom Tools

The agent can create its own tools at runtime. Custom tools are stored as `customtool:*` documents and use the same hash-based approval system as skills — if the code or parameters change, approval is automatically revoked.

| Tool | Mode | Description |
|------|------|-------------|
| `create_custom_tool` | sandbox | Define a new custom tool with name, description, parameters, and TypeScript code. |
| `list_custom_tools` | sandbox | List all custom tools with approval status. |
| `call_custom_tool` | sandbox | Execute an approved custom tool in a fresh Deno sandbox with declared secrets. |

### Web

Requires `EXA_API_KEY` for Exa-backed tools. `http_get` works without credentials.

| Tool | Mode | Description |
|------|------|-------------|
| `web_search` | sandbox | Search via Exa AI. Returns title, URL, snippet, and score. |
| `fetch_page` | sandbox | Extract page content via Exa AI. Returns title, URL, text, author, and date. |
| `http_get` | sandbox | Plain HTTP GET with 30s timeout. Returns status, content type, and body. |

### Media & Utilities

| Tool | Mode | Description |
|------|------|-------------|
| `view_image` | native | Fetch an image URL and return it as a base64 image block for the model to see. |
| `summarize` | both | Summarize text via the sub-agent LLM. Requires `[sub_model]` config. |
| `notify_discord` | sandbox | Send a message to a Discord webhook. Requires `DISCORD_WEBHOOK_URL` secret. |

### Scheduling

| Tool | Mode | Description |
|------|------|-------------|
| `schedule_task` | sandbox | Schedule a self-contained prompt on a cron expression or interval. |
| `list_tasks` | sandbox | Show all scheduled tasks with run count and last run status. |
| `cancel_task` | sandbox | Stop a scheduled task by ID. |

Tasks support optional trigger guards: TypeScript code that runs before the prompt without consuming LLM tokens. If the guard produces output, the prompt fires; if it produces nothing, the task is skipped.

## Creating Tools

The agent constructs new tools in two ways:

1. **Skills** — TypeScript code saved as `skill:*` documents and executed via `run_skill`. Reviewed and approved through the **Tools** screen (`t`) in the TUI.
2. **Custom tools** — Runtime-defined tools created via `create_custom_tool`, stored as `customtool:*` documents. Same hash-based approval workflow: if code changes, approval is revoked until re-approved.

## Prerequisites

- **[Bun](https://bun.sh)** (v1.0+) — runtime and package manager
- **[Deno](https://deno.com)** (v2.0+) — sandboxed code execution backend
- **[Ollama](https://ollama.com)** (optional) — local embeddings for semantic search
- A model API key (Anthropic) or a local inference endpoint (Ollama, Lemonade, etc.)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Numina-Systems/johnson.git
cd johnson
bun install

# Copy and customize the persona
cp persona.md.example persona.md

# Pull the embedding model (optional — enables semantic document search)
ollama pull nomic-embed-text

# Start the TUI
bun start
```

## Configuration

Configuration is managed through `config.toml`. Environment variables override config values where noted.

### Interface Mode

```toml
# "tui" — terminal UI only (default)
# "discord" — Discord bot only
# "both" — run TUI and Discord bot simultaneously
interface = "tui"
```

### Model Providers

Johnson supports five LLM providers.

#### Lemonade (default — local inference)

```toml
[model]
provider = "lemonade"
name = "Gemma-4-26B-A4B-it-GGUF"
max_tokens = 8192
```

Lemonade runs on `http://localhost:13305/api/v1` by default. Override with:

```bash
export LEMONADE_BASE_URL="http://192.168.1.50:13305/api/v1"
```

#### Ollama (local inference)

```toml
[model]
provider = "ollama"
name = "llama3.1:8b"
max_tokens = 8192
```

```bash
export OLLAMA_BASE_URL="http://localhost:11434"  # default
```

#### Anthropic (cloud)

```toml
[model]
provider = "anthropic"
name = "claude-sonnet-4-20250514"
max_tokens = 8192
```

```bash
export ANTHROPIC_API_KEY="***"
```

#### OpenRouter (cloud)

```toml
[model]
provider = "openrouter"
name = "google/gemma-4-31b-it"
max_tokens = 8192
```

```bash
export OPENROUTER_API_KEY="***"
```

#### OpenAI-compatible (any endpoint)

```toml
[model]
provider = "openai-compat"
name = "gpt-4o"
max_tokens = 8192
```

```bash
export OPENAI_COMPAT_API_KEY="***"
export OPENAI_COMPAT_BASE_URL="https://api.openai.com/v1"
```

#### Reasoning (extended thinking)

Models that support extended thinking can be configured with a reasoning effort:

```toml
[model]
provider = "anthropic"
name = "claude-sonnet-4-20250514"
max_tokens = 8192
reasoning = "medium"  # none, low, medium, high
```

### Agent Settings

```toml
[agent]
max_tool_rounds = 50      # max consecutive tool calls per turn
context_budget = 0.8      # fraction of context window to use before compacting
context_limit = 131072    # must match model's actual context window
model_timeout = 300000    # ms to wait for model response
timezone = "America/New_York"  # IANA timezone for scheduling and display
```

### Sub-Agent (utility LLM)

A lightweight model used for background tasks: context compaction, session title generation, and the `summarize` tool. Falls back to wrapping the main model (capped at 8k tokens) if not configured.

```toml
[sub_model]
provider = "anthropic"
name = "claude-haiku-4-5-20251001"
max_tokens = 8000
```

```bash
export SUB_MODEL_PROVIDER="anthropic"  # override via env
```

Supports the same five providers as `[model]`.

### Runtime (Deno Sandbox)

```toml
[runtime]
working_dir = "./workspace"   # agent's scratch space for task output
allowed_hosts = []            # network allowlist (empty = no network)
timeout_ms = 30000            # code execution timeout
max_code_size = 100000        # max bytes per script
max_output_size = 500000      # max stdout capture
unrestricted = false          # true = --allow-all (use with caution)
```

When `unrestricted = true`, all Deno permissions are granted. The `data/` directory remains denied for both read and write access regardless of this setting.

### Embeddings (Semantic Search)

Embeddings power the hybrid search in `doc_search`, combining FTS5 keyword matching with vector similarity via Reciprocal Rank Fusion. Requires Ollama running locally.

```toml
[embedding]
provider = "ollama"
model = "nomic-embed-text"
dimensions = 768
```

If Ollama is unavailable, the agent starts normally and semantic search falls back to keyword matching alone.

## Discord Bot Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** in the sidebar
4. Click **Reset Token** and copy the token
5. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required — the bot reads message text)
6. Click **Save Changes**

### 2. Invite the Bot to Your Server

1. Go to **OAuth2 → URL Generator** in the sidebar
2. Under **Scopes**, check `bot`
3. Under **Bot Permissions**, check:
   - View Channels (Read Messages)
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Send Messages in Threads (optional)
4. Copy the generated URL and open it in your browser to invite the bot

### 3. Configure johnson

```bash
export DISCORD_BOT_TOKEN="***"
```

Or add to `config.toml`:

```toml
[discord]
token = "MTIz..."
prefix = "!"                  # command prefix for guild messages (default: "!")
allowed_channels = []         # channel ID allowlist — empty means all channels
allowed_users = []            # user ID allowlist — empty means respond to everyone
```

### 4. Set the Interface Mode

```toml
interface = "discord"   # or "both" for TUI + Discord simultaneously
```

### 5. Run

```bash
bun start
```

### How the Bot Responds

In DMs, the bot responds to every message without requiring a prefix. In guild channels, it responds when mentioned (`@botname how do I...`) or when the message begins with the configured prefix (`!how do I...`). Sending `reset` (with prefix or mention) clears the conversation for that channel. Each Discord channel maintains its own conversation history and agent instance. Responses exceeding 2000 characters are split automatically at the Discord limit.

## How Memory Works

The agent manages its own memory through the unified document store described above, with a layered retrieval strategy designed to balance context efficiency against completeness.

The `self` document is injected into the system prompt on every turn, giving the agent persistent access to its own behavioural notes. The `operator` document — a compact index of key user facts with pointers to `ref:*` documents — is not auto-loaded; the agent fetches it on demand to save tokens. Detailed reference material (vault structure, protocols, project specs) lives in `ref:<topic>` documents, which the `operator` doc points to but which the agent retrieves only when the current task requires them.

The persona instructs the agent to save user preferences, corrections, and task context without being asked. All documents are FTS5-indexed, and when embeddings are configured, search combines keyword matching with vector similarity through Reciprocal Rank Fusion. The rkey prefix conventions (`skill:`, `ref:`, `task:`, `context/`) provide organisational structure without enforcing schema.

## Persona

The agent's personality and tool-usage instructions live in `persona.md`, which is read from disk on every conversation turn, so changes take effect immediately. The agent cannot modify this file; it is operator-controlled. This distinction matters: `persona.md` contains *your* instructions to the agent, while the `self` document contains the agent's own notes about itself.

Copy `persona.md.example` to get started and customise the personality section.
