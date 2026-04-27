# Feature Parity — Build Order DAG

This document defines the dependency graph and implementation steps for all 14 feature-parity issues. Features are grouped into waves that can execute in parallel. Within each wave, independent features can be built by separate agents simultaneously.

## Dependency Graph

```
Wave 0 (foundations — no dependencies)
├── #14 Standalone Secrets Management
├── #11 Extended Thinking / Reasoning Content Preservation
└── #1  Graceful Max-Iteration Exhaustion

Wave 1 (depends on Wave 0)
├── #4  Sub-Agent LLM                          (depends on: #14 for secret resolution)
├── #2  Event Emission / Lifecycle Hooks        (no hard deps, but Wave 0 clears the agent loop)
├── #12 Dynamic System Prompt Provider          (no hard deps, touches agent loop)
└── #3  Multi-Tool Architecture                 (no hard deps, major registry refactor)

Wave 2 (depends on Wave 1)
├── #7  Built-In Web Tools                      (depends on: #3 native tools, #14 secrets)
├── #6  Outbound Notification Tool              (depends on: #3 native tools, #14 secrets)
├── #9  Image Viewing Tool                      (depends on: #3 native tools + content block support)
├── #8  Summarization Tool                      (depends on: #3 native tools, #4 sub-agent)
└── #5  Auto-Generated Session Titles           (depends on: #4 sub-agent)

Wave 3 (depends on Wave 2)
├── #10 Custom Tool Creation + Approval         (depends on: #3 multi-tool, #14 secrets)
└── #13 Multi-Screen TUI                        (depends on: #2 events, #5 titles, #14 secrets, #10 custom tools)
```

## Edge List (for tooling)

```
#4  → #14
#7  → #3, #14
#6  → #3, #14
#9  → #3
#8  → #3, #4
#5  → #4
#10 → #3, #14
#13 → #2, #5, #10, #14
```

---

## Wave 0 — Foundations

### #14 Standalone Secrets Management

**Status:** Mostly done. `src/secrets/manager.ts` already implements the full `SecretManager` interface (listKeys, get, set, remove, resolve). Stored at `data/secrets.json`.

**Remaining work:**
1. Verify the existing `SecretManager` type is exported and usable by new consumers (web tools, notification tool, custom tools)
2. Add `save()` returning a `Promise<void>` that callers can await (currently fire-and-forget)
3. Add integration test: create manager, set/get/remove/resolve secrets, verify JSON file on disk
4. No TUI work yet — that's #13

**Files touched:** `src/secrets/manager.ts`, `src/secrets/index.ts`, new test file

---

### #11 Extended Thinking / Reasoning Content Preservation

**Steps:**
1. Add `ReasoningBlock` to model types: `{ type: 'thinking'; thinking: string }` in `src/model/types.ts`
2. Add `reasoning_content?: string` field to `ModelResponse` in `src/model/types.ts`
3. Update each model provider to extract reasoning content from API responses:
   - `src/model/anthropic.ts` — extract from `thinking` content blocks
   - `src/model/openrouter.ts` — extract from response metadata / reasoning field
   - `src/model/openai-compat.ts` — extract if present (o1-style reasoning)
   - `src/model/ollama.ts` — no-op (local models don't emit reasoning)
4. In `src/agent/agent.ts`, after building `assistantMessage`, attach `reasoning_content` if present — store it on the message object (extend `Message` type or use a side map)
5. Update `src/agent/compaction.ts` `formatConversation()` to include reasoning content when serializing for compaction
6. Add test: mock model response with reasoning → verify it's stored on the assistant message in history

**Files touched:** `src/model/types.ts`, `src/model/anthropic.ts`, `src/model/openrouter.ts`, `src/model/openai-compat.ts`, `src/agent/agent.ts`, `src/agent/compaction.ts`

---

### #1 Graceful Max-Iteration Exhaustion

**Steps:**
1. In `src/agent/agent.ts`, after the `for` loop (line ~233), detect whether the loop exited because `round === maxToolRounds` (vs. `end_turn`/`max_tokens`)
2. If exhausted: push a system-style user message `[System: Max tool calls reached. Provide final response now.]` to history
3. Make one final `deps.model.complete()` call with `tools: []` (no tools available)
4. Accumulate usage stats from this final call into `totalInputTokens`, `totalOutputTokens`, increment `rounds`
5. Push the final assistant response to history
6. Existing text extraction logic at line ~236 handles the rest
7. Add test: mock model that always returns `tool_use` → verify final forced response after maxToolRounds

**Files touched:** `src/agent/agent.ts`

**Implementation detail:** Track a `let exitedNormally = false` flag. Set it true inside the `end_turn`/`max_tokens` break. After the for-loop, check `if (!exitedNormally)`.

---

## Wave 1 — Core Infrastructure

### #4 Sub-Agent LLM

**Steps:**
1. Add sub-model config types to `src/config/types.ts`:
   ```
   SubModelConfig {
     provider: 'anthropic' | 'openai-compat';
     name: string;
     maxTokens: number;     // default 8000
     baseUrl?: string;
     apiKey?: string;
   }
   ```
   Add `subModel?: SubModelConfig` to `AppConfig`.
2. Add TOML keys `[sub_model]` to `src/config/loader.ts` with env overrides (`SUB_MODEL_NAME`, `SUB_MODEL_API_KEY`, etc.)
3. Create `src/model/sub-agent.ts` — a lightweight wrapper:
   - Takes `SubModelConfig`
   - Implements a simple `complete(prompt: string, system?: string): Promise<string>` (text in, text out — not `ModelProvider`)
   - Uses Anthropic SDK or fetch-based OpenAI-compat call
   - Falls back to the main `ModelProvider` if sub-model not configured
4. Export a `SubAgentLLM` type from `src/model/sub-agent.ts`
5. Wire up in `src/index.ts`: create `SubAgentLLM` from config, pass into `AgentDependencies`
6. Add `subAgent?: SubAgentLLM` to `AgentDependencies` in `src/agent/types.ts`
7. Update compaction (`src/agent/compaction.ts`) to prefer sub-agent for summarization when available
8. Add test: sub-agent with mocked provider returns expected text

**Files touched:** `src/config/types.ts`, `src/config/loader.ts`, `src/model/sub-agent.ts` (new), `src/agent/types.ts`, `src/agent/compaction.ts`, `src/index.ts`

---

### #2 Event Emission / Lifecycle Hooks

**Steps:**
1. Define event types in `src/agent/types.ts`:
   ```
   type AgentEventKind = 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done';
   type AgentEvent = { kind: AgentEventKind; data: Record<string, unknown> };
   ```
2. Add `onEvent?: (event: AgentEvent) => Promise<void>` to `ChatOptions`
3. In `src/agent/agent.ts`, create a helper `const emit = async (kind, data) => { if (options?.onEvent) await options.onEvent({ kind, data }); };`
4. Emit events at four points in the tool loop:
   - Before `deps.model.complete()`: `emit('llm_start', { round })`
   - After `deps.model.complete()`: `emit('llm_done', { round, usage: response.usage, stop_reason: response.stop_reason })`
   - Before `deps.runtime.execute()`: `emit('tool_start', { tool: 'execute_code', code: code.slice(0, 500) })`
   - After `deps.runtime.execute()`: `emit('tool_done', { tool: 'execute_code', success: result.success, preview: (result.output ?? '').slice(0, 200) })`
5. Add test: provide onEvent callback, run chat with tool use, verify all four event kinds fired in order

**Files touched:** `src/agent/types.ts`, `src/agent/agent.ts`

---

### #12 Dynamic System Prompt Provider

**Steps:**
1. Add `systemPromptProvider?: () => Promise<string>` to `AgentDependencies` in `src/agent/types.ts`
2. In `src/agent/agent.ts` `_chatImpl`, before the existing prompt-building block (lines 96-106), check for `deps.systemPromptProvider`:
   - If present: call it, catch errors and log + fall back to previous cached prompt
   - If absent: use existing `buildSystemPrompt()` logic (no change)
3. Store last-good prompt in a closure variable `let cachedSystemPrompt = ''`
4. Wire up in `src/index.ts`: create a provider function that calls `buildSystemPrompt()` with fresh data from store (self doc, skills, tool docs, secrets list)
5. This makes the existing prompt-building logic the *default provider* — same behavior, now hookable
6. Add test: provider that throws → verify fallback to cached prompt

**Files touched:** `src/agent/types.ts`, `src/agent/agent.ts`, `src/index.ts`

---

### #3 Multi-Tool Architecture

**REVISED:** Keep `execute_code` as primary dispatch. Native tool_use only for tools where the result format demands it (images) or sandbox adds no value (notify, summarize). Existing 8 tools stay sandbox-only. See `docs/projects/3/design.md` for full rationale.

**Steps:**
1. **Extend ToolRegistry** (`src/runtime/tool-registry.ts`):
   - Add `mode: 'sandbox' | 'native' | 'both'` per tool entry
   - Add `generateToolDefinitions(): ToolDefinition[]` — returns definitions for native/both-mode tools only
   - Existing `generateTypeScriptStubs()` generates stubs for sandbox/both-mode tools only
   - Existing `generateToolDocumentation()` documents ALL tools regardless of mode

2. **Update agent loop** (`src/agent/agent.ts`):
   - Build tool list: `[EXECUTE_CODE_TOOL, ...registry.generateToolDefinitions()]`
   - When dispatching `tool_use` blocks, check tool name:
     - If `execute_code`: existing Deno sandbox path (unchanged)
     - If any other registered tool: call `registry.execute(name, input)` directly
   - Add `formatNativeToolResult()` helper for image content block support

3. **Update model types** (`src/model/types.ts`):
   - Widen `ToolResultBlock.content` to `string | Array<ContentBlock>`

4. **Existing tools unchanged** — all 8 remain `mode: 'sandbox'`

5. **Native tools (added by later features):**
   - `view_image` (#9) — `mode: 'native'` (image content blocks)
   - `notify_discord` (#6) — `mode: 'both'` (native + sandbox for scheduled tasks)
   - `summarize` (#8) — `mode: 'both'` (native + sandbox for composition)

**Files touched:** `src/runtime/tool-registry.ts`, `src/agent/agent.ts`, `src/model/types.ts`

---

## Wave 2 — Tools and Features

### #7 Built-In Web Tools

**Steps:**
1. Create `src/tools/web.ts` with three tool definitions:
   - `web_search` — calls Exa search API (`api.exa.ai/search`)
   - `fetch_page` — calls Exa contents API (`api.exa.ai/contents`)
   - `http_get` — plain `fetch()` GET request
2. Each returns structured JSON results (title, url, snippet, score for search; text + metadata for fetch)
3. Register all three in `src/agent/tools.ts` via `createAgentTools()` — conditionally based on Exa API key availability
4. Exa API key resolution: check `deps.secrets?.get('EXA_API_KEY')` then fall back to `process.env.EXA_API_KEY`
5. `http_get` always available (no API key needed). `web_search` and `fetch_page` return clear error if no Exa key
6. Add `mode: 'native'` so these are exposed as direct tool_use definitions
7. Truncation: `max_chars` param (default 10000, cap 50000) for `fetch_page` and `http_get`
8. Add tests: mock fetch responses, verify structured output

**Files touched:** `src/tools/web.ts` (new), `src/agent/tools.ts`

---

### #6 Outbound Notification Tool (Discord Webhook)

**Steps:**
1. Create `src/tools/notify.ts` with `notify_discord` tool definition
2. Parameters: `content` (required string), `title` (optional string)
3. Implementation:
   - Get webhook URL from `deps.secrets?.get('DISCORD_WEBHOOK_URL')`
   - If missing: return error message
   - If `title` provided: POST JSON with `embeds: [{ title, description: content.slice(0, 2000) }]`
   - Otherwise: POST JSON with `content: content.slice(0, 2000)`
4. Register in `src/agent/tools.ts` with `mode: 'native'`
5. Add test: mock fetch, verify correct webhook payload shape for plain and embed modes

**Files touched:** `src/tools/notify.ts` (new), `src/agent/tools.ts`

---

### #9 Image Viewing Tool

**Steps:**
1. Create `src/tools/image.ts` with `view_image` tool definition
2. Parameters: `url` (required string)
3. Implementation:
   - `fetch(url)` with timeout
   - Validate `content-type` starts with `image/`
   - Reject if `content-length > 10MB`
   - Read body as `ArrayBuffer`, convert to base64
   - Return structured result: `{ type: 'image_result', text: 'Image from <url>', image: { type: 'base64', media_type, data } }`
4. Update agent loop tool result handling in `src/agent/agent.ts`:
   - When a native tool returns an object with `type: 'image_result'`, format the `ToolResultBlock` content as an array containing both a text block and an Anthropic image block
   - This requires the `ToolResultBlock.content` update from #3
5. Register in `src/agent/tools.ts` with `mode: 'native'`
6. Add test: mock fetch returning PNG bytes → verify base64 encoding and content block structure

**Files touched:** `src/tools/image.ts` (new), `src/agent/tools.ts`, `src/agent/agent.ts` (tool result formatting)

---

### #8 Summarization Tool (via Sub-Agent)

**Steps:**
1. Create `src/tools/summarize.ts` with `summarize` tool definition
2. Parameters: `text` (required), `instructions` (optional), `max_length` (optional, enum short/medium/long)
3. Implementation:
   - Truncate input at 100k chars
   - Map `max_length` to guidance string
   - Call `deps.subAgent.complete(prompt, system)` with summarization system prompt
   - Return `{ summary: result }`
4. Guard: if `deps.subAgent` is undefined, return error "Sub-agent LLM not configured"
5. Register in `src/agent/tools.ts` with `mode: 'native'`
6. Add test: mock sub-agent, verify prompt construction and result

**Files touched:** `src/tools/summarize.ts` (new), `src/agent/tools.ts`

---

### #5 Auto-Generated Session Titles

**Steps:**
1. Create `src/agent/session-title.ts`:
   - `maybeGenerateSessionTitle(store, sessionId, subAgent, messages)` function
   - Guard: skip if session already has a title, < 2 user messages, or no sub-agent
   - Take first 10 messages, format as text
   - Call sub-agent with title generation prompt
   - Post-process: strip quotes, take first line, cap at 80 chars
   - Persist via `store.updateSessionTitle(sessionId, title)`
2. Call from `src/agent/agent.ts` at the end of `_chatImpl` (after returning result, non-blocking)
3. Need session ID available in agent — add `sessionId?: string` to `ChatOptions`
4. Add test: mock sub-agent returns title → verify store updated

**Files touched:** `src/agent/session-title.ts` (new), `src/agent/agent.ts`, `src/agent/types.ts`

---

## Wave 3 — Integration Features

### #10 Custom Tool Creation + Approval Workflow

**REVISED:** Sandbox-only dispatch. Custom tools are NOT exposed as native tool_use definitions. Called via `tools.call_custom_tool({ name, params })` inside execute_code. See `docs/projects/10/design.md` for rationale (prompt cache invalidation, composition, approval surface simplicity).

**Steps:**
1. Create `src/tools/custom-tool-manager.ts`:
   - `CustomTool` type: `{ name, description, parameters (JSON Schema), code (TypeScript), approved, codeHash, secrets: string[] }`
   - Storage: `customtool:<name>` documents in the store, content is JSON-serialized `CustomTool`
   - `listTools()`, `getTool(name)`, `saveTool(tool)`, `approveTool(name)`, `revokeTool(name)`
   - `getApprovedToolSummaries()`: returns `[{ name, description }]` for system prompt listing
   - Auto-revoke: on `saveTool`, if code or parameters changed (hash mismatch), set `approved = false`

2. Create `src/tools/custom-tools.ts` — agent-facing tools (all `mode: 'sandbox'`):
   - `create_custom_tool` — agent provides name, description, parameters schema, code, optional secrets list
   - `list_custom_tools` — returns all custom tools with approval status
   - `call_custom_tool` — execute an approved custom tool by name (runs code via Deno sandbox with declared secrets injected)

3. Register in `src/agent/tools.ts` with `mode: 'sandbox'`

4. System prompt integration via #12 provider — lists approved custom tool names + descriptions for discoverability

5. Add tests:
   - Create tool → verify stored as unapproved
   - Approve → change code → verify auto-revoked
   - Call approved tool → verify Deno execution with secrets

**Files touched:** `src/tools/custom-tool-manager.ts` (new), `src/tools/custom-tools.ts` (new), `src/agent/tools.ts`, `src/agent/types.ts`, `src/index.ts`

---

### #13 Multi-Screen TUI

This is the largest UI feature. The current TUI is a single `App.tsx` with chat + review pages.

**Steps:**
1. **Refactor navigation** — replace `page` state string with a screen stack:
   - Create `src/tui/types.ts` with `Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt' | 'tool-detail'`
   - Create `src/tui/Navigation.tsx` — manages screen stack, global key bindings

2. **Session List Screen** (`src/tui/screens/SessionListScreen.tsx`):
   - List sessions from `store.listSessions()` with titles and dates
   - `n` = new session, `d` = delete, `Enter` = open in chat
   - Display model name, secret count, tool counts in header

3. **Chat Screen** — refactor from current `App.tsx`:
   - Wire `onEvent` callback from #2 to show thinking/running indicators
   - Show token stats bar from `ChatStats`
   - `Escape` = back to sessions

4. **Tools Screen** (`src/tui/screens/ToolsScreen.tsx`):
   - List custom tools from `CustomToolManager` (#10)
   - Show approval status, description
   - `a` = approve, `r` = revoke, `Enter` = view detail
   - Also show built-in tools (read-only)

5. **Secrets Screen** (`src/tui/screens/SecretsScreen.tsx`):
   - List secret names from `SecretManager` (#14)
   - `a` = add new secret (prompt for name + value), `d` = delete
   - Never display values after entry

6. **Schedules Screen** (`src/tui/screens/SchedulesScreen.tsx`):
   - List tasks from scheduler
   - Show name, schedule, last run time, status
   - `e` = enable/disable toggle

7. **System Prompt Screen** (`src/tui/screens/SystemPromptScreen.tsx`):
   - Display current assembled system prompt (read-only, scrollable)
   - Useful for debugging what the agent sees

8. **Global navigation keys:** `t` = tools, `s` = secrets, `c` = schedules, `p` = prompt, `q` = quit
   - These work from any screen

9. **Wire props:** Update `src/index.ts` `startTUI()` to pass scheduler, custom tool manager, and all dependencies

10. Add basic rendering tests for each screen component

**Files touched:** `src/tui/App.tsx` (major refactor), `src/tui/types.ts` (new), `src/tui/Navigation.tsx` (new), `src/tui/screens/` (6 new files), `src/tui/index.ts`, `src/index.ts`

---

## Parallel Execution Plan

```
Time →

Agent A:  [#14 secrets]──────[#4 sub-agent]────────[#8 summarize]──[#10 custom tools]
Agent B:  [#11 reasoning]────[#2 events]───────────[#5 titles]─────[#13 TUI]────────→
Agent C:  [#1 max-iter]──────[#3 multi-tool]───────[#7 web tools]──────────────────→
Agent D:                     [#12 prompt provider]─[#6 notify]─────[#9 image]──────→
```

**Merge gates:** Each wave must pass tests before the next wave starts consuming its outputs. Within a wave, agents work on isolated file sets and merge to a shared integration branch at wave boundaries.
