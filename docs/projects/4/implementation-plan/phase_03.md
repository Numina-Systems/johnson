# Sub-Agent LLM Implementation Plan -- Phase 3: Wiring and Compaction Update

**Goal:** Wire the sub-agent into `AgentDependencies`, create it in `src/index.ts`, and update compaction to use it instead of the main model.

**Architecture:** The sub-agent is created once in `main()` (either via `createSubAgent` if configured, or `wrapMainModel` as fallback) and passed through `AgentDependencies` to all consumers. Compaction's `summarizeOlderContext()` is simplified from accepting `model + modelName + maxTokens` to accepting a single `SubAgentLLM`. The `compactContext` deps object is similarly simplified.

**Tech Stack:** TypeScript, Bun runtime

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH04.AC4: Compaction uses sub-agent instead of main model
- **GH04.AC4.1 Success:** `summarizeOlderContext()` calls `subAgent.complete()` instead of `model.complete()`
- **GH04.AC4.2 Success:** `compactContext()` deps parameter uses `subAgent: SubAgentLLM` instead of `model: ModelProvider` + `modelName` + `maxTokens`

### GH04.AC5: `subAgent` available on `AgentDependencies` for downstream consumers
- **GH04.AC5.1 Success:** `subAgent` field added to `AgentDependencies` type (optional, since fallback is created in index.ts)
- **GH04.AC5.2 Success:** Sub-agent created and passed into `AgentDependencies` in `src/index.ts`

---

<!-- START_TASK_1 -->
### Task 1: Add `subAgent` to `AgentDependencies` in `src/agent/types.ts`

**Verifies:** GH04.AC5.1

**Files:**
- Modify: `src/agent/types.ts` (add import, add field)

**Implementation:**

1. Add import for `SubAgentLLM` at the top of the file:

```typescript
import type { SubAgentLLM } from '../model/sub-agent.ts';
```

2. Add `subAgent` as an optional field to `AgentDependencies` (after the `secrets` field on line 45):

```typescript
export type AgentDependencies = {
  readonly model: ModelProvider;
  readonly runtime: CodeRuntime;
  readonly config: AgentConfig;
  readonly personaPath: string;
  readonly embedding?: EmbeddingProvider;
  readonly vectorStore?: VectorStore;
  readonly scheduler?: TaskStore;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly subAgent?: SubAgentLLM;
};
```

The field is optional so existing call sites (tests, etc.) don't break. The wiring in `src/index.ts` (Task 3) will always provide it.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(agent): add subAgent field to AgentDependencies`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update compaction to use sub-agent

**Verifies:** GH04.AC4.1, GH04.AC4.2

**Files:**
- Modify: `src/agent/compaction.ts` (update import, update function signatures, update function bodies)

**Implementation:**

1. Replace the `ModelProvider` import with `SubAgentLLM`:

Change the import on line 9 from:
```typescript
import type { Message, ModelProvider } from '../model/types.ts';
```
to:
```typescript
import type { Message } from '../model/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
```

2. Simplify `summarizeOlderContext()` (lines 90-119). Change the signature from:

```typescript
async function summarizeOlderContext(
  model: ModelProvider,
  modelName: string,
  maxTokens: number,
  notes: ReadonlyArray<string>,
): Promise<string> {
```

to:

```typescript
async function summarizeOlderContext(
  subAgent: SubAgentLLM,
  notes: ReadonlyArray<string>,
): Promise<string> {
```

Replace the body's `model.complete()` call (lines 103-118) with:

```typescript
  if (notes.length === 0) return '';

  const combined = notes
    .map((text, i) => `--- Context ${i + 1} ---\n${text.slice(0, 3000)}`)
    .join('\n\n');

  const system =
    'You are a context summarizer. Given conversation logs, produce a concise 2-4 sentence summary capturing the key topics discussed, decisions made, and any important facts or preferences revealed. Focus on what would be useful for continuing the conversation. Do not use markdown headers or bullet points -- write flowing prose.';

  const text = await subAgent.complete(combined, system);
  return text || '(summary unavailable)';
```

This eliminates the response content block filtering -- `SubAgentLLM.complete()` already returns plain text.

3. Update `compactContext()` deps parameter (lines 128-136). Change from:

```typescript
export async function compactContext(
  messages: ReadonlyArray<Message>,
  deps: {
    store: Store;
    model: ModelProvider;
    modelName: string;
    maxTokens: number;
  },
): Promise<Array<Message>> {
```

to:

```typescript
export async function compactContext(
  messages: ReadonlyArray<Message>,
  deps: {
    store: Store;
    subAgent: SubAgentLLM;
  },
): Promise<Array<Message>> {
```

4. Update the `summarizeOlderContext` call site inside `compactContext()` (lines 157-161). Change from:

```typescript
    olderSummary = await summarizeOlderContext(
      deps.model,
      deps.modelName,
      deps.maxTokens,
      olderDocs.map((d) => d.content),
    );
```

to:

```typescript
    olderSummary = await summarizeOlderContext(
      deps.subAgent,
      olderDocs.map((d) => d.content),
    );
```

5. Update the `compactContext` call site in `src/agent/agent.ts` (lines 135-140). Change from:

```typescript
      const compacted = await compactContext(history, {
        store: deps.store,
        model: deps.model,
        modelName: deps.config.model,
        maxTokens: deps.config.maxTokens,
      });
```

to:

```typescript
      const compacted = await compactContext(history, {
        store: deps.store,
        subAgent: deps.subAgent!,
      });
```

The `!` assertion is safe because `src/index.ts` (Task 3) always provides `subAgent` via either `createSubAgent` or `wrapMainModel`. The type is optional on `AgentDependencies` for API flexibility, but the wiring guarantees it at runtime.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `refactor(compaction): use SubAgentLLM instead of main ModelProvider`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire sub-agent creation in `src/index.ts`

**Verifies:** GH04.AC5.2

**Files:**
- Modify: `src/index.ts` (add imports, add creation logic, add to agentDeps)

**Implementation:**

1. Add imports after the existing model import (line 11):

```typescript
import { createSubAgent, wrapMainModel } from './model/sub-agent.ts';
import type { SubAgentLLM } from './model/sub-agent.ts';
```

2. After the `secrets` creation (line 48) and before the `embedding` block (line 51), add sub-agent creation:

```typescript
  // Sub-agent LLM -- cheap model for compaction, titles, summarization
  // Falls back to wrapping the main model if [sub_model] not configured
  const subAgent: SubAgentLLM = config.subModel
    ? createSubAgent(config.subModel)
    : wrapMainModel(model, config.model.name, config.model.maxTokens);
```

3. Add `subAgent` to the `agentDeps` object (after `secrets` on line 93):

```typescript
  const agentDeps: AgentDependencies = {
    model,
    runtime,
    config: {
      model: config.model.name,
      maxTokens: config.model.maxTokens,
      maxToolRounds: config.agent.maxToolRounds,
      contextBudget: config.agent.contextBudget,
      contextLimit: config.agent.contextLimit,
      modelTimeout: config.agent.modelTimeout,
      timezone: config.agent.timezone,
    },
    personaPath: PERSONA_PATH,
    embedding,
    get scheduler() { return scheduler; },
    store,
    secrets,
    subAgent,
  };
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun run build`
Expected: Builds without errors

**Commit:** `feat: wire sub-agent creation into main startup`

<!-- END_TASK_3 -->
