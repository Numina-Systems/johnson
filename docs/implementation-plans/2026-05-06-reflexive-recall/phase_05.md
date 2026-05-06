# Reflexive Recall Implementation Plan — Phase 5: Agent Loop Integration

**Goal:** Wire recall into the `chat()` flow, add config fields, and emit lifecycle events.

**Architecture:** Modify the Imperative Shell in `src/agent/agent.ts` to call `performRecall()` after compaction check but before the tool loop. Add `recallEnabled` (default false) and `recallTokenBudget` (default 1500) to config types and loader. Extend `AgentEventKind` with `'recall_done'`. Update both `systemPromptProvider` and inline prompt builder to pass recalled context through to `buildSystemPrompt()`.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-05-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC8: Lifecycle Event
- **reflexive-recall.AC8.1 Success:** recall_done event emitted with elapsed ms and fragment count
- **reflexive-recall.AC8.2 Success:** Event fires even when recall returns zero fragments

### reflexive-recall.AC6: Guard Conditions (partial — config gate)
- **reflexive-recall.AC6.1 Success:** recall_enabled=false skips recall entirely (default behavior)

### reflexive-recall.AC9: Compaction Ordering
- **reflexive-recall.AC9.1 Success:** Recall runs after compaction check completes
- **reflexive-recall.AC9.2 Success:** Recalled context tokens are not included in compaction threshold estimate

---

<!-- START_TASK_1 -->
### Task 1: Add recall config fields to types and loader

**Verifies:** reflexive-recall.AC6.1

**Files:**
- Modify: `src/config/types.ts:32-38` (AgentLoopConfig type)
- Modify: `src/config/loader.ts:94-100` (agent config loading block)

**Implementation:**

In `src/config/types.ts`, add two fields to `AgentLoopConfig`:

```typescript
export type AgentLoopConfig = {
  readonly maxToolRounds: number;
  readonly contextBudget: number;
  readonly contextLimit: number;
  readonly modelTimeout: number;
  readonly timezone: string;
  readonly recallEnabled: boolean;       // NEW — default false
  readonly recallTokenBudget: number;    // NEW — default 1500
};
```

In `src/config/loader.ts`, add the two fields to the agent config loading block (around line 94-100), using the existing `pick()` helper:

```typescript
const agent: AgentLoopConfig = {
  maxToolRounds: pick(raw.agent, 'maxToolRounds', DEFAULT_AGENT.maxToolRounds),
  contextBudget: pick(raw.agent, 'contextBudget', DEFAULT_AGENT.contextBudget),
  contextLimit: pick(raw.agent, 'contextLimit', DEFAULT_AGENT.contextLimit),
  modelTimeout: pick(raw.agent, 'modelTimeout', DEFAULT_AGENT.modelTimeout),
  timezone: pick(raw.agent, 'timezone', DEFAULT_AGENT.timezone),
  recallEnabled: pick(raw.agent, 'recallEnabled', false),            // NEW
  recallTokenBudget: pick(raw.agent, 'recallTokenBudget', 1500),     // NEW
};
```

Also update the `DEFAULT_AGENT` constant (find it near the top of loader.ts) to include the new defaults:

```typescript
recallEnabled: false,
recallTokenBudget: 1500,
```

This supports TOML config:
```toml
[agent]
recall_enabled = true        # or recallEnabled = true
recall_token_budget = 2000   # or recallTokenBudget = 2000
```

**Important: Config section disambiguation.** The codebase already has a `[recall]` TOML section with `enabled`, `endpoint`, and `timeoutMs` fields (type `RecallConfig` in `src/config/types.ts:55-59`). That section controls the external HTTP `RecallClient` (`src/recall/client.ts`). The new `[agent].recall_enabled` and `[agent].recall_token_budget` control the local reflexive recall pipeline — they are separate concerns. The existing `RecallConfig` and `RecallClient` are left in place for potential future use as an alternative recall backend. Do NOT add new fields to the `[recall]` section for local recall.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds. Existing config tests pass (the new fields have defaults so existing TOML configs without them will still load fine).

```bash
bun test src/config/loader.test.ts
```

Expected: All existing config tests pass.

**Commit:** `feat(recall): add recallEnabled and recallTokenBudget config fields`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend AgentEventKind and AgentConfig with recall fields

**Verifies:** reflexive-recall.AC8.1

**Files:**
- Modify: `src/agent/types.ts:39-54` (AgentDependencies — no changes needed, deps come from config)
- Modify: `src/agent/types.ts:70-75` (AgentEventKind union)

**Implementation:**

In `src/agent/types.ts`, extend `AgentEventKind` to include `'recall_done'`:

```typescript
export type AgentEventKind = 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done' | 'recall_done';
```

**Design deviation (intentional):** The design doc says "Add `recallEnabled` boolean to `AgentDependencies`" as a top-level field. This plan instead routes it through `AgentConfig` (inside `AgentDependencies.config`), which is where all other agent behavior flags live (`maxToolRounds`, `contextBudget`, etc.). This is more consistent with the existing pattern.

Find the `AgentConfig` type definition (used inside `AgentDependencies.config`) and add:

```typescript
readonly recallEnabled: boolean;
readonly recallTokenBudget: number;
```

Then update the wiring in `src/index.ts` where `agentDeps.config` is constructed (around line 118-141) to pass the new fields from `config.agent`:

```typescript
config: {
  model: config.model.name,
  maxTokens: config.model.maxTokens,
  maxToolRounds: config.agent.maxToolRounds,
  contextBudget: config.agent.contextBudget,
  contextLimit: config.agent.contextLimit,
  modelTimeout: config.agent.modelTimeout,
  timezone: config.agent.timezone,
  recallEnabled: config.agent.recallEnabled,           // NEW
  recallTokenBudget: config.agent.recallTokenBudget,   // NEW
},
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): extend AgentEventKind and AgentConfig with recall fields`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire recall into chat() flow

**Verifies:** reflexive-recall.AC6.1, reflexive-recall.AC8.1, reflexive-recall.AC8.2, reflexive-recall.AC9.1, reflexive-recall.AC9.2

**Files:**
- Modify: `src/agent/agent.ts` (chat function, around lines 215-228 — between compaction and tool loop)
- Modify: `src/agent/agent.ts` (system prompt build section, around lines 150-177)
- Modify: `src/index.ts` (systemPromptProvider, around lines 108-116)

**Implementation:**

**Step 1: Add recall step in chat() after compaction check.**

In `src/agent/agent.ts`, after the compaction check block (around line 225) and before the tool loop (around line 228), add:

```typescript
// Recall step — runs after compaction, before tool loop
let recalledContext: ReadonlyArray<{ rkey: string; content: string }> | undefined;
if (deps.config.recallEnabled) {
  const userText = typeof userMessage === 'string' ? userMessage : userMessage;
  const recallResult = await performRecall(userText, {
    store: deps.store,
    embedding: deps.embedding,
    subAgent: deps.subAgent,
    tokenBudget: deps.config.recallTokenBudget,
  });
  if (recallResult) {
    recalledContext = recallResult.fragments.map(f => ({ rkey: f.rkey, content: f.content }));
    await emit('recall_done', {
      elapsed: recallResult.elapsed,
      fragmentCount: recallResult.fragments.length,
      totalTokens: recallResult.totalTokens,
    });
  } else {
    await emit('recall_done', { elapsed: 0, fragmentCount: 0, totalTokens: 0 });
  }
}
```

Import `performRecall` from `../recall/index.ts` at the top of agent.ts.

**Key design decisions:**
- AC6.1: `deps.config.recallEnabled` check — when false (default), entire block is skipped. This is the ONLY guard in `chat()`. All other guards (missing embedding, short message, empty store) are handled inside `performRecall()` (Phase 3).
- The `deps.embedding` and `deps.subAgent` values are passed directly to `performRecall()` — they may be `undefined`. Phase 3's `RecallDeps` type accepts both as optional (`EmbeddingProvider | undefined` and `SubAgentLLM | undefined`). When embedding is missing, `performRecall` returns null (AC6.4). When subAgent is missing, `performRecall` falls back to `fallbackDecomposition` using the raw message as a single query (AC5.1 fallback cascade).
- AC9.1: Block is placed AFTER compaction check, ensuring recall runs on compacted context.
- AC9.2: Recalled context is NOT in `history` — it's injected into the system prompt only. The compaction threshold estimate uses `history` tokens, not system prompt tokens. So recalled context tokens don't inflate the compaction trigger.
- AC8.1: `recall_done` event emitted with elapsed, fragmentCount, and totalTokens.
- AC8.2: Even when `performRecall` returns null (guards triggered), the event fires with zeros.

**Step 2: Restructure prompt build to happen after recall.**

Currently the system prompt is built BEFORE compaction (lines 150-177), but recall runs AFTER compaction. Rather than building the prompt twice (once without recall, then rebuilding with recall), restructure `chat()` so the prompt is built once, after both compaction and recall have completed. This avoids duplicating the custom tools summary injection logic.

**Reorder in chat():**

1. Create tool registry + generate tool docs (existing, unchanged — lines 136-147)
2. Append user message to history (existing, unchanged — lines 195-203)
3. Repair orphaned tool_use blocks (existing, unchanged — lines 205-212)
4. Compaction check (existing, unchanged — lines 215-225)
5. **Recall step** (new — produces `recalledContext`)
6. **Build system prompt** (moved from before step 2 to after step 5) — now passes `recalledContext`
7. Tool loop begins (existing, unchanged)

The `buildInlinePrompt` helper and `systemPromptProvider` call both move to after the recall step. This is a reorder of existing code, not a rewrite.

**Update `systemPromptProvider` type** in `src/agent/types.ts`:

```typescript
readonly systemPromptProvider?: (
  toolDocs: string,
  recalledContext?: ReadonlyArray<{ readonly rkey: string; readonly content: string }>,
) => Promise<string>;
```

**Update `systemPromptProvider` implementation** in `src/index.ts` (around line 108-116):

```typescript
const systemPromptProvider = async (
  toolDocs: string,
  recalledContext?: ReadonlyArray<{ readonly rkey: string; readonly content: string }>,
): Promise<string> => {
  const persona = await Bun.file(PERSONA_PATH).text();
  const coreMemory = loadCoreMemoryFromStore(store);
  const allDocs = store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  return buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, config.agent.timezone, recalledContext);
};
```

**Update inline fallback** in `src/agent/agent.ts` (the `buildInlinePrompt` function):

```typescript
const buildInlinePrompt = async (
  recalledCtx?: ReadonlyArray<{ readonly rkey: string; readonly content: string }>,
): Promise<string> => {
  const persona = await Bun.file(deps.personaPath).text();
  const coreMemory = loadCoreMemoryFromStore(deps.store);
  const allDocs = deps.store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  return buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, deps.config.timezone, recalledCtx);
};
```

**Build prompt once after recall:**

```typescript
// After recall step, build system prompt (moved here from earlier in the flow)
if (deps.systemPromptProvider) {
  try {
    systemPrompt = await deps.systemPromptProvider(toolDocs, recalledContext);
    cachedSystemPrompt = systemPrompt;
  } catch (err) {
    systemPrompt = cachedSystemPrompt ?? await buildInlinePrompt(recalledContext);
  }
} else {
  systemPrompt = await buildInlinePrompt(recalledContext);
}

// Append custom tools (existing logic, unchanged, runs once)
if (deps.customTools) {
  const summaries = deps.customTools.getApprovedToolSummaries();
  if (summaries.length > 0) {
    const listing = summaries.map(s => `- **${s.name}** — ${s.description}`).join('\n');
    systemPrompt += `\n\n## Custom Tools (call via tools.call_custom_tool)\n\n${listing}`;
  }
}
```

This eliminates the rebuild path entirely — prompt is built exactly once with all context (including recall) already available.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

```bash
bun test
```

Expected: All existing tests pass. The recall step is gated behind `recallEnabled: false` (default), so existing tests won't trigger it.

**Commit:** `feat(recall): wire performRecall into chat() with lifecycle events and config gate`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Agent loop recall tests

**Verifies:** reflexive-recall.AC6.1, reflexive-recall.AC8.1, reflexive-recall.AC8.2, reflexive-recall.AC9.1, reflexive-recall.AC9.2

**Files:**
- Modify: `src/agent/agent.test.ts` (add new describe block for recall integration)

**Testing:**

Add a new `describe('recall integration', ...)` block in `src/agent/agent.test.ts`. Follow the existing test patterns — use `makeDeps()`, `makeConfig()`, mock model responses.

**reflexive-recall.AC6.1 — recall_enabled=false skips recall:**

Create agent with `recallEnabled: false` in config (the default). Provide embedding and subAgent in deps. Collect events via `onEvent`. Send a message. Verify that NO `recall_done` event is emitted.

**reflexive-recall.AC6.1 — recall_enabled=true triggers recall:**

Create agent with `recallEnabled: true`, provide mock embedding and subAgent. Seed store with a `knowledge:test` document. Collect events. Send a message. Verify that a `recall_done` event IS emitted.

**reflexive-recall.AC8.1 — recall_done event data:**

Same setup as above. Verify the `recall_done` event has `elapsed` (number >= 0), `fragmentCount` (number >= 0), and `totalTokens` (number >= 0).

**reflexive-recall.AC8.2 — recall_done fires with zero fragments:**

Create agent with `recallEnabled: true` but empty store (no documents). The guard in `performRecall` returns null. Verify `recall_done` event fires with `fragmentCount: 0`.

**reflexive-recall.AC9.1 — recall runs after compaction:**

This is structural — verify by checking event ordering. If compaction fires (set contextLimit low enough to trigger it), the `recall_done` event should appear after any compaction-related activity and before `llm_start`. This may be hard to test directly; an alternative is to verify that the recall step sees compacted context (i.e., archive documents created by compaction are available to recall search).

**reflexive-recall.AC9.2 — recalled context not in compaction estimate:**

Verify that with `recallEnabled: true` and a recalled context section in the prompt, compaction threshold is based on history tokens only (not including the recalled context section). This is inherently true because recalled context is in the system prompt, not in `history`. A test can verify that adding recall doesn't change whether compaction triggers (same history = same compaction decision regardless of recall).

**Verification:**

```bash
bun test src/agent/agent.test.ts
```

Expected: All tests pass (existing + new).

**Commit:** `test(recall): add agent loop recall integration tests`
<!-- END_TASK_4 -->
