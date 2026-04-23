# Johnson

An AI agent harness with a TUI and an optional Discord interface, built around a single premise: the agent has one callable tool—`execute_code`—and writes everything else as code on your behalf. While it started in a different place, the architecture borrows from [Victrola](https://github.com/haileyok/victrola) at this point.

Why Johnson? Because I thought it would be very amusing to say things like "Johnson, get me the Danforth file" or "Johnson, take this down".

> [!WARNING]
> Tools run in a Deno sandbox. This offers reasonable isolation, but not a security guarantee. Exercise judgement.

## TUI Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history |
| `/review` | Open the skill grant management page |
| `/help` | Show help |
| `/quit` | Exit |

## Tools

The agent exposes eight built-in tools across four categories.

### Code Execution

| Tool | Description |
|------|-------------|
| `execute_code` | Run TypeScript in the Deno sandbox. The only top-level callable function. |

### Documents

All agent memory is stored as documents, each identified by an `rkey` and containing free-form `content`. This unified document store — rather than separate subsystems for notes, skills, and context — means the agent's memory is searchable, versioned, and inspectable in one place.

| Tool | Description |
|------|-------------|
| `doc_upsert` | Create or update a document by rkey. For `skill:*` rkeys, auto-manages grants. |
| `doc_get` | Read one or more documents by rkey (batch reads supported). |
| `doc_list` | List all documents with short content previews. |
| `doc_search` | Full-text search across all documents. |

#### Conventional rkeys

| Prefix | Purpose | Auto-loaded? |
||--------|---------|-------------|
|| `self` | Agent identity, behavior notes | ✅ Yes — injected into system prompt every turn |
|| `operator` | Compact user profile — key facts and pointers to `ref:*` docs | ❌ No — agent fetches on demand |
|| `ref:<topic>` | Detailed reference material (vault structure, protocols, etc.) | ❌ No — fetched when `operator` points to them |
|| `skill:<name>` | Reusable TypeScript skills | Names listed in system prompt |
|| `task:<name>` | Long-running task state | ❌ No |
|| `context/<ts>` | Context compaction snapshots | Used internally |
|| *(anything else)* | Free-form notes, facts, reminders | ❌ No |

### Skills

| Tool | Description |
|------|-------------|
| `run_skill` | Execute an approved `skill:*` document. Args passed as an array (spaces preserved). |

Skills require human approval before they may run with secrets. When a skill is created or modified, it enters a "pending" state; the operator reviews the code, grants access, and assigns secrets through the `/review` interface in the TUI.

### Scheduling

| Tool | Description |
|------|-------------|
| `schedule_task` | Schedule a self-contained prompt on a cron expression or interval |
| `list_tasks` | Show all scheduled tasks with run count and last run status |
| `cancel_task` | Stop a scheduled task by ID |

Tasks support optional trigger guards: TypeScript code that runs before the prompt without consuming LLM tokens. If the guard produces output, the prompt fires; if it produces nothing, the task is skipped.

## Creating Tools

The agent constructs new tools as TypeScript code, which it saves as skill documents and executes in the Deno runtime. No skill may run until the operator has reviewed its code, approved it, and — where necessary — associated secrets with it via `/review` in the TUI.

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

Johnson supports four LLM providers.

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

### Agent Settings

```toml
[agent]
max_tool_rounds = 50      # max consecutive tool calls per turn
context_budget = 0.8      # fraction of context window to use before compacting
context_limit = 131072    # must match model's actual context window
model_timeout = 300000    # ms to wait for model response
```

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
