# Sub-Agent LLM Implementation Plan -- Phase 2: Sub-Agent Factory and Provider Implementations

**Goal:** Create `src/model/sub-agent.ts` with the `SubAgentLLM` type, a factory function for all five providers, and a fallback wrapper for the main `ModelProvider`.

**Architecture:** `SubAgentLLM` is deliberately minimal -- `complete(prompt, system?) -> Promise<string>`. It is NOT a `ModelProvider` (no tools, no content blocks, no streaming). The factory function `createSubAgent()` switches on provider and returns thin fetch-based wrappers for each. The `wrapMainModel()` fallback adapts the existing `ModelProvider.complete()` interface for use when no sub-model is configured. Each provider implementation is self-contained -- no shared code with the main model providers is needed since these are simple single-shot calls.

**Tech Stack:** TypeScript, Anthropic SDK (`@anthropic-ai/sdk` v0.39.0), `fetch` for OpenAI-compat/OpenRouter/Ollama endpoints, Bun runtime

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH04.AC1: SubAgentLLM type exported with `complete(prompt, system?) -> Promise<string>`
- **GH04.AC1.1 Success:** `SubAgentLLM` type defined and exported from `src/model/sub-agent.ts`
- **GH04.AC1.2 Success:** `complete()` accepts prompt string and optional system string, returns `Promise<string>`

### GH04.AC2: All five providers work: anthropic, openai-compat, openrouter, ollama, lemonade
- **GH04.AC2.1 Success:** Anthropic provider uses Anthropic SDK messages API, extracts text-only response
- **GH04.AC2.2 Success:** OpenAI-compat provider uses fetch POST to `/chat/completions`, extracts `choices[0].message.content`
- **GH04.AC2.3 Success:** OpenRouter provider uses same fetch logic as OpenAI-compat but defaults base URL to `https://openrouter.ai/api/v1`
- **GH04.AC2.4 Success:** Ollama provider uses fetch POST to `/api/chat`, extracts `message.content`
- **GH04.AC2.5 Success:** Lemonade provider delegates to OpenAI-compat with default base URL `http://localhost:13305/api/v1` and API key `lemonade`

### GH04.AC3: Fallback wraps main model when `[sub_model]` not configured
- **GH04.AC3.1 Success:** `wrapMainModel()` accepts `ModelProvider` + model name + maxTokens, returns `SubAgentLLM`
- **GH04.AC3.2 Success:** Fallback calls `model.complete()` with `tools: []` and extracts text from content blocks

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/model/sub-agent.ts` with type, factory, and all provider implementations

**Verifies:** GH04.AC1.1, GH04.AC1.2, GH04.AC2.1, GH04.AC2.2, GH04.AC2.3, GH04.AC2.4, GH04.AC2.5

**Files:**
- Create: `src/model/sub-agent.ts`

**Implementation:**

Create the file with `// pattern: Imperative Shell` header. The file exports:

1. **`SubAgentLLM` type:**
```typescript
export type SubAgentLLM = {
  complete(prompt: string, system?: string): Promise<string>;
};
```

2. **`createSubAgent(config: SubModelConfig): SubAgentLLM` factory** that switches on `config.provider`:

**Anthropic branch:** Uses the Anthropic SDK (already a dependency at `@anthropic-ai/sdk` v0.39.0). Creates an `Anthropic` client with the config's `apiKey`. Calls `client.messages.create()` with:
- `model`: config.name
- `max_tokens`: config.maxTokens
- `messages`: `[{ role: 'user', content: prompt }]`
- `system`: the system param if provided
Extracts text by filtering response content blocks for `type === 'text'` and joining their `.text` values.

**OpenAI-compat branch:** Uses `fetch` POST to `config.baseUrl + '/chat/completions'`. Request body:
- `model`: config.name
- `max_tokens`: config.maxTokens
- `messages`: system message (if provided) + user message
Response parsing: `choices[0].message.content` (same pattern as `src/model/openai-compat.ts` lines 248-281 but drastically simplified -- no tool handling needed).
Includes `Authorization: Bearer ${config.apiKey}` header when apiKey is set.
Timeout: 120s via `AbortController`.

**OpenRouter branch:** Identical to OpenAI-compat. The only difference is the default `baseUrl` which is already resolved by the config loader in Phase 1 (defaults to `https://openrouter.ai/api/v1` via `resolveBaseUrl`). Delegates to the same internal fetch logic. Can be implemented by extracting a shared helper function used by both openai-compat and openrouter branches.

**Ollama branch:** Uses `fetch` POST to `config.baseUrl + '/api/chat'` (default Ollama base URL is `http://localhost:11434`, resolved by config loader). Request body:
- `model`: config.name
- `messages`: system message (if provided) + user message
- `stream`: false
- `options.num_predict`: config.maxTokens
Response parsing: `response.message.content` (same structure as `src/model/ollama.ts` lines 163-168 but without tool handling).

**Lemonade branch:** Delegates to the OpenAI-compat logic. The config loader already resolves the default base URL (`http://localhost:13305/api/v1`) and API key (`lemonade`) via `resolveBaseUrl` and `resolveApiKey`. No special handling needed -- just reuse the OpenAI-compat code path.

Implementation pattern: extract a `completeViaOpenAI(baseUrl, apiKey, model, maxTokens, prompt, system?)` helper for the OpenAI-compat, OpenRouter, and Lemonade branches to share. Anthropic and Ollama each get their own inline implementation due to different API shapes.

Error handling: wrap each provider's call in try/catch. On failure, throw with a descriptive message including the provider name and original error.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(model): create sub-agent factory with all five provider implementations`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `wrapMainModel()` fallback function

**Verifies:** GH04.AC3.1, GH04.AC3.2

**Files:**
- Modify: `src/model/sub-agent.ts` (add function after factory)

**Implementation:**

Add an exported function to `src/model/sub-agent.ts`:

```typescript
export function wrapMainModel(
  model: ModelProvider,
  modelName: string,
  maxTokens: number,
): SubAgentLLM {
  return {
    async complete(prompt: string, system?: string): Promise<string> {
      const response = await model.complete({
        messages: [{ role: 'user', content: prompt }],
        system,
        tools: [],
        model: modelName,
        max_tokens: Math.min(maxTokens, 8000),
      });
      return response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
    },
  };
}
```

This requires importing `ModelProvider` from `./types.ts`. The `tools: []` is intentional -- sub-agent calls are pure text completion, no tool use.

The `Math.min(maxTokens, 8000)` cap prevents the fallback from burning excessive tokens on what should be a cheap utility call (compaction summaries, session titles, etc.).

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(model): add wrapMainModel fallback for sub-agent`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
