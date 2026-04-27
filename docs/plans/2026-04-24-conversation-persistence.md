# Conversation Persistence — Option A (Shared Agent + Session Override)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Johnson remember conversations across restarts and across scheduled task runs by persisting message history to SQLite and loading it back on demand — following Victrola's "shared agent, swapped history" model.

**Architecture:** Instead of one agent per channel (current), there is ONE shared agent instance. Each Discord thread/channel and each scheduled task gets a persistent *session* in SQLite. Before each `chat()` call, the caller loads the session's message history from the DB and passes it as a `conversationOverride`. After the call, new messages are saved back. The agent's internal `history` is only used by the TUI (the "default" session). A chat lock serializes all callers.

**Tech Stack:** Bun SQLite (already in use), existing `sessions`/`messages` tables in `store.ts`

**Key design decisions:**
- Agent interface gets `conversationOverride` parameter (like Victrola's model)
- Agent gets an async chat lock to prevent concurrent mutation of history
- Discord bot changes from `Map<string, Agent>` (many agents) to one shared agent + `Map<string, Message[]>` cache
- Scheduler uses a persistent session per task ID — run-to-run memory accumulates naturally
- Message serialization: `ContentBlock[]` stored as JSON strings in the `content` column; plain strings stored as-is

---

## Task 1: Add `ensureSession` to the Store

**Objective:** Add an idempotent session creation method so callers don't need try/catch on duplicate IDs.

**Files:**
- Modify: `src/store/store.ts` — add `ensureSession` to interface and implementation

**Step 1: Add to Store interface (line ~56)**

After `createSession`, add:

```typescript
  ensureSession(id: string, title?: string): void;
```

**Step 2: Add prepared statement (after line ~263)**

```typescript
  const stmtEnsureSession = db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  );
```

**Step 3: Add implementation (after `createSession` implementation, ~line 386)**

```typescript
    ensureSession(id: string, title?: string): void {
      const now = iso();
      stmtEnsureSession.run(id, title ?? null, now, now);
    },
```

**Step 4: Verify**

Run: `bun run build` — should compile without errors.

**Step 5: Commit**

```bash
git add src/store/store.ts
git commit -m "feat(store): add ensureSession for idempotent session creation"
```

---

## Task 2: Add `conversationOverride` to Agent interface

**Objective:** Allow callers to pass in a session's history for a single `chat()` call. The agent uses that history instead of its own, then restores its own history afterward. Add a chat lock.

**Files:**
- Modify: `src/agent/types.ts` — update `Agent.chat` signature
- Modify: `src/agent/agent.ts` — implement override + lock

### Step 1: Update the type (`src/agent/types.ts`)

Change the `Agent` type's `chat` method:

```typescript
export type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
};

export type Agent = {
  chat(userMessage: string, options?: ChatOptions): Promise<ChatResult>;
  reset(): void;
};
```

This is a breaking change to the `chat` signature. The old positional args `(userMessage, context?, images?)` become a single options object. Every caller needs updating (TUI, Discord bot, scheduler) — handled in later tasks.

### Step 2: Implement in `src/agent/agent.ts`

Replace the function signature and add lock + override logic. The key changes:

**a) Add a Mutex/lock at the top of `createAgent`:**

```typescript
export function createAgent(deps: Readonly<AgentDependencies>): Agent {
  let history: Array<Message> = [];
  let currentContext: ChatContext = {};
  let chatLock: Promise<void> = Promise.resolve();

  async function chat(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    // Serialize all chat() calls
    let resolve: () => void;
    const prevLock = chatLock;
    chatLock = new Promise<void>((r) => { resolve = r; });

    await prevLock;
    try {
      return await _chatImpl(userMessage, options);
    } finally {
      resolve!();
    }
  }
```

**b) Rename the current `chat` body to `_chatImpl` and add the swap logic:**

```typescript
  async function _chatImpl(userMessage: string, options?: ChatOptions): Promise<ChatResult> {
    const chatStart = performance.now();
    currentContext = options?.context ?? {};
    const images = options?.images;

    // Swap history if override provided
    const savedHistory = options?.conversationOverride !== undefined ? history : null;
    if (options?.conversationOverride !== undefined) {
      history = [...options.conversationOverride];
    }

    try {
      // ... existing chat body (unchanged) ...
      // (everything from "Create tool registry" through to the return statement)
    } finally {
      // Restore original history if we swapped
      if (savedHistory !== null) {
        history = savedHistory;
      }
    }
  }
```

**Important:** The `finally` block ensures the TUI's history is restored even if the Discord/scheduler call throws.

### Step 3: Verify

Run: `bun run build` — will fail because callers use old signature. That's expected; we fix them next.

### Step 4: Commit

```bash
git add src/agent/types.ts src/agent/agent.ts
git commit -m "feat(agent): add conversationOverride + chat lock for session isolation"
```

---

## Task 3: Update TUI to use new `chat()` signature

**Objective:** Adapt the TUI's `agent.chat(input)` call to the new options-based signature.

**Files:**
- Modify: `src/tui/App.tsx` (~line 99)

**Step 1:** Change:

```typescript
const result = await agent.chat(input);
```

to:

```typescript
const result = await agent.chat(input);
```

This actually doesn't change — the TUI passes no options, which is fine (options is optional, defaults to `{}`). The TUI continues to use the agent's own internal `history` as before.

**Verify:** `bun run build` — may still fail if Discord/scheduler aren't updated yet.

---

## Task 4: Rewrite Discord bot — shared agent + persistent sessions

**Objective:** Replace the per-channel agent Map with a single shared agent. Load/save conversation history from SQLite for each thread.

**Files:**
- Modify: `src/discord/bot.ts` — major rewrite of session handling
- Modify: `src/index.ts` — pass store to Discord bot, pass single agent instead of factory

### Step 1: Update `createDiscordBot` signature

The function currently takes `(config, createAgent)`. Change to:

```typescript
export function createDiscordBot(
  config: Readonly<DiscordConfig>,
  agent: Agent,
  store: Store,
): { start(): Promise<void>; stop(): void; sendToChannel(channelId: string, message: string): Promise<void> } {
```

### Step 2: Remove the per-channel agent Map and getAgent()

Delete:
```typescript
const agents = new Map<string, Agent>();
// ...
function getAgent(channelId: string): Agent { ... }
```

### Step 3: Add message serialization helpers

```typescript
import type { Message, ContentBlock } from '../model/types.ts';

function serializeMessage(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  return JSON.stringify(msg.content);
}

function deserializeMessage(role: string, content: string): Message {
  // Try parsing as JSON (structured content blocks)
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { role: role as 'user' | 'assistant', content: parsed as ContentBlock[] };
    }
  } catch { /* plain string */ }
  return { role: role as 'user' | 'assistant', content };
}
```

### Step 4: Add `loadConversation` helper

```typescript
function loadConversation(sessionId: string): Message[] {
  const rows = store.getMessages(sessionId, 500);
  return rows.map(r => deserializeMessage(r.role, r.content));
}
```

### Step 5: Rewrite `processMessage` to load/save

```typescript
async function processMessage(
  content: string,
  channelId: string,
  authorId: string,
  reply: (text: string) => Promise<void>,
  images?: ChatImage[],
): Promise<void> {
  if (client.user && authorId === client.user.id) return;
  if (allowedUsers && !allowedUsers.has(authorId)) return;
  if (!content.trim()) return;

  let processed = content;
  if (processed.startsWith(prefix)) {
    processed = processed.slice(prefix.length).trim();
  }
  if (client.user) {
    processed = processed.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  }
  if (!processed) return;

  // Handle reset — clear the session
  if (processed === 'reset') {
    // We could delete the session from the DB, but for now just acknowledge
    await reply('🔄 Conversation reset.');
    return;
  }

  // Ensure session exists
  store.ensureSession(channelId);

  // Load existing conversation history
  const history = loadConversation(channelId);

  // Save user message BEFORE calling agent
  store.appendMessage(channelId, 'user', content);

  // Send typing indicator
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && 'sendTyping' in channel) await channel.sendTyping();
  } catch { /* ignore */ }

  let typingInterval: ReturnType<typeof setInterval> | undefined;
  try {
    typingInterval = setInterval(async () => {
      try {
        const ch = client.channels.cache.get(channelId);
        if (ch && 'sendTyping' in ch) await ch.sendTyping();
      } catch { /* ignore */ }
    }, 8_000);

    const result = await agent.chat(processed, {
      context: { channelId },
      images,
      conversationOverride: history,
    });
    const response = result.text;

    // Save assistant response
    store.appendMessage(channelId, 'assistant', response);

    const statsLine = `-# ${formatStats(result.stats)}`;
    const chunks = splitMessage(response || '(no response)');
    for (const chunk of chunks) {
      await reply(chunk);
    }
    await reply(statsLine);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await reply(`❌ Error: ${errMsg.slice(0, 500)}`).catch(() => {});
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}
```

**Key difference from Victrola:** Victrola saves user+assistant messages and drops the last user message before passing to `chat()` (because `chat()` re-appends it). Johnson's `chat()` also appends the user message internally, so we pass history *without* the current user message — we save it to DB for persistence but don't include it in the override since `chat()` will add it.

Wait — that means we should save the user message to DB but NOT include it in the `conversationOverride`. The `loadConversation` call happens before `appendMessage`, so this works naturally: `history` has everything up to but not including the current message.

### Step 6: Update `index.ts` to pass shared agent + store

Change:

```typescript
bot = createDiscordBot(config.discord, makeAgent);
```

to:

```typescript
const sharedAgent = makeAgent();
bot = createDiscordBot(config.discord, sharedAgent, store);
```

And for the TUI, keep creating its own agent (or share — but keeping it separate is simpler since the TUI uses internal history):

```typescript
if (mode === 'tui' || mode === 'both') {
  const tuiAgent = makeAgent();
  startTUI({ agent: tuiAgent, modelName, store, secrets });
}
```

### Step 7: Verify

Run: `bun run build`

### Step 8: Commit

```bash
git add src/discord/bot.ts src/index.ts
git commit -m "feat(discord): shared agent with persistent session history"
```

---

## Task 5: Add persistent sessions for scheduled tasks

**Objective:** Each scheduled task gets a persistent session keyed by its task ID. Run-to-run memory accumulates — the agent sees its own previous outputs and any user corrections relayed through the prompt.

**Files:**
- Modify: `src/scheduler/scheduler.ts` — load/save session per task run

### Step 1: Import types and add serialization helpers

Add at the top:

```typescript
import type { Message, ContentBlock } from '../model/types.ts';
```

Add the same `deserializeMessage` helper as the Discord bot (or extract to a shared util — see Task 6).

### Step 2: Update `SchedulerDeps` to accept a shared agent + store

The scheduler already has `store` in its deps. It also has `createAgent` as a factory. Change to accept both — use the shared agent for chat, keep the factory as fallback for if you ever need throwaway agents:

Actually, looking at this more carefully: the scheduler should use the **shared agent** with `conversationOverride`, not a throwaway agent. Change `SchedulerDeps`:

```typescript
type SchedulerDeps = {
  readonly agent: Agent;              // shared agent (was createAgent)
  readonly persistPath: string;
  readonly sendDiscord?: DiscordSender;
  readonly runtime?: CodeRuntime;
  readonly store?: Store;
  readonly secrets?: SecretManager;
};
```

### Step 3: Rewrite `runTask` to use persistent sessions

In `runTask`, after trigger evaluation succeeds:

```typescript
// Phase 2: Fire prompt through agent with persistent session
const sessionId = `task:${live.state.id}`;

// Ensure session exists
if (deps.store) {
  deps.store.ensureSession(sessionId, live.state.name);
}

// Load conversation history for this task
const history: Message[] = deps.store
  ? deps.store.getMessages(sessionId, 500).map(r => deserializeMessage(r.role, r.content))
  : [];

const context: ChatContext = { channelId: live.state.deliverTo };

const prompt = triggerData
  ? `Context from trigger:\n${triggerData}\n\n${live.state.prompt}`
  : live.state.prompt;

// Save the prompt as user message before calling agent
if (deps.store) {
  deps.store.appendMessage(sessionId, 'user', prompt);
}

const result = await deps.agent.chat(prompt, {
  context,
  conversationOverride: history,
});
output = result.text;
success = true;

// Save agent response
if (deps.store) {
  deps.store.appendMessage(sessionId, 'assistant', output);
}
```

### Step 4: Update `index.ts` to pass shared agent to scheduler

```typescript
const sharedAgent = makeAgent();

const scheduler: TaskStore = createScheduler({
  agent: sharedAgent,          // was: createAgent: makeAgent
  persistPath: TASKS_PATH,
  get sendDiscord() { return sendDiscord; },
  runtime,
  store,
  secrets,
});

// ...
bot = createDiscordBot(config.discord, sharedAgent, store);
```

### Step 5: Verify

Run: `bun run build`

### Step 6: Commit

```bash
git add src/scheduler/scheduler.ts src/scheduler/types.ts src/index.ts
git commit -m "feat(scheduler): persistent sessions for run-to-run task memory"
```

---

## Task 6: Extract shared message serialization utilities

**Objective:** Both the Discord bot and scheduler need the same `serializeMessage`/`deserializeMessage` functions. Extract to a shared module.

**Files:**
- Create: `src/agent/messages.ts`
- Modify: `src/discord/bot.ts` — import from shared module
- Modify: `src/scheduler/scheduler.ts` — import from shared module

### Step 1: Create `src/agent/messages.ts`

```typescript
// pattern: Functional Core — message serialization for persistent sessions

import type { Message, ContentBlock } from '../model/types.ts';

/**
 * Serialize a Message's content for storage in the messages table.
 * Plain strings stay as-is; structured ContentBlock arrays become JSON.
 */
export function serializeMessage(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  return JSON.stringify(msg.content);
}

/**
 * Deserialize a stored message back into the agent's Message type.
 * Attempts JSON parse for structured content; falls back to plain string.
 */
export function deserializeMessage(role: string, content: string): Message {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { role: role as 'user' | 'assistant', content: parsed as ContentBlock[] };
    }
  } catch { /* plain string */ }
  return { role: role as 'user' | 'assistant', content };
}

/**
 * Load a full conversation from the store for a given session ID.
 */
export function loadConversation(
  store: { getMessages(sessionId: string, limit?: number): Array<{ role: string; content: string }> },
  sessionId: string,
  limit: number = 500,
): Message[] {
  const rows = store.getMessages(sessionId, limit);
  return rows.map(r => deserializeMessage(r.role, r.content));
}
```

### Step 2: Update imports in bot.ts and scheduler.ts

```typescript
import { loadConversation } from '../agent/messages.ts';
```

### Step 3: Commit

```bash
git add src/agent/messages.ts src/discord/bot.ts src/scheduler/scheduler.ts
git commit -m "refactor: extract shared message serialization utilities"
```

---

## Task 7: Handle the `reset` command properly for persistent sessions

**Objective:** When a user says "reset" in Discord, clear the session's stored messages so the next conversation starts fresh.

**Files:**
- Modify: `src/store/store.ts` — add `clearMessages(sessionId)` method
- Modify: `src/discord/bot.ts` — call it on reset

### Step 1: Add to Store interface

```typescript
  clearMessages(sessionId: string): void;
```

### Step 2: Add prepared statement and implementation

```typescript
  const stmtClearMessages = db.prepare(
    `DELETE FROM messages WHERE session_id = ?`,
  );

  // In the store object:
  clearMessages(sessionId: string): void {
    stmtClearMessages.run(sessionId);
  },
```

### Step 3: Update Discord bot reset handler

```typescript
if (processed === 'reset') {
  store.clearMessages(channelId);
  await reply('🔄 Conversation reset.');
  return;
}
```

### Step 4: Commit

```bash
git add src/store/store.ts src/discord/bot.ts
git commit -m "feat: clear persisted messages on conversation reset"
```

---

## Task 8: Store structured assistant messages (tool calls + results)

**Objective:** Currently `appendMessage` stores a single string. Assistant messages with tool calls are `ContentBlock[]`. We need to also save the intermediate tool call/result messages so the full conversation can be reconstructed.

**Consideration:** This is where it gets nuanced. Victrola saves only user text + assistant text (no tool calls). The tool calls exist in the in-memory conversation during a `chat()` call but aren't persisted. This means:

**Option A (simpler, Victrola-style):** Only persist `user` and `assistant` text messages. On reload, the agent sees the conversation as a clean back-and-forth without tool call details. Loses tool call context but dramatically simpler.

**Option B (full fidelity):** Persist every message including tool calls and results. Full context on reload but complex serialization and much larger stored conversations.

**Recommendation: Go with Option A (Victrola-style).** The agent doesn't need to see old tool calls to learn from corrections — it just needs the conversational context. The `self` and `operator` documents handle persistent tool-level knowledge. This means:

- The Discord bot saves `user` text (what the user said) and `assistant` text (the final response)
- Tool calls/results during execution are ephemeral (in-memory only, discarded after the chat lock releases)
- On reload, the conversation looks like a clean dialogue

This is already what the code in Tasks 4/5 does — `store.appendMessage(channelId, 'user', content)` and `store.appendMessage(channelId, 'assistant', response)` only save the text.

**No code changes needed** — this task is a design decision documentation. Commit the plan itself.

---

## Task 9: Verify end-to-end

**Objective:** Manual integration testing.

### Test 1: Discord thread persistence
1. Send a message to Johnson in Discord
2. Get a response
3. Restart Johnson (`bun start`)
4. Send a follow-up in the same thread
5. Verify Johnson remembers the previous exchange

### Test 2: Scheduled task memory
1. Create a scheduled task (e.g., email check)
2. Let it fire once
3. Let it fire again
4. Verify the second run's agent sees the first run's conversation

### Test 3: Cross-surface isolation
1. Chat in Discord thread A
2. Chat in Discord thread B
3. Verify thread B doesn't see thread A's history

### Test 4: Reset
1. Chat in a Discord thread
2. Say "reset"
3. Send another message
4. Verify Johnson doesn't remember pre-reset messages

### Test 5: TUI isolation
1. Chat in TUI
2. Verify TUI still works with its own in-memory history (no override)

---

## Summary of files changed

| File | Change |
|------|--------|
| `src/store/store.ts` | Add `ensureSession`, `clearMessages` |
| `src/agent/types.ts` | Add `ChatOptions` type, update `Agent.chat` signature |
| `src/agent/agent.ts` | Add chat lock, `conversationOverride` swap logic |
| `src/agent/messages.ts` | **New** — shared serialization utils |
| `src/discord/bot.ts` | Shared agent, load/save sessions, reset clears DB |
| `src/scheduler/scheduler.ts` | Use shared agent with persistent task sessions |
| `src/index.ts` | Create shared agent, pass to Discord + scheduler |
| `src/tui/App.tsx` | No change (uses default `chat(msg)` with no options) |

Total: ~120 lines of new/changed code across 7 files, 1 new file.
