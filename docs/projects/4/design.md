# #4 — Sub-Agent LLM for Tool-Side Work

**Issue:** https://github.com/Numina-Systems/johnson/issues/4
**Wave:** 1 (depends on: #14 secrets)

## Current State

Compaction uses the main model for summarization. No tools or infrastructure can independently call an LLM. Every LLM call burns main-model tokens.

## Design

### Interface

New file `src/model/sub-agent.ts`:

```typescript
type SubAgentLLM = {
  complete(prompt: string, system?: string): Promise<string>;
};
```

Deliberately **not** `ModelProvider` — no tools, no content blocks, no streaming. Pure text in, text out. Single-shot utility calls only.

### Config

New section `[sub_model]` in `config.toml`:

```toml
[sub_model]
provider = "anthropic"               # anthropic | openai-compat | openrouter | ollama | lemonade
name = "claude-haiku-4-5-20251001"
max_tokens = 8000
base_url = "..."                     # optional
api_key = "..."                      # optional, env: SUB_MODEL_API_KEY
```

Add `SubModelConfig` to `src/config/types.ts`:

```typescript
type SubModelConfig = {
  readonly provider: 'anthropic' | 'openai-compat' | 'openrouter' | 'ollama' | 'lemonade';
  readonly name: string;
  readonly maxTokens: number;        // default 8000
  readonly baseUrl?: string;
  readonly apiKey?: string;
};
```

Add `subModel?: SubModelConfig` to `AppConfig`.

### Provider Support

All five model providers supported:

- **Anthropic** — Anthropic SDK, messages API, text-only response extraction
- **OpenAI-compat** — fetch-based POST to `/chat/completions`, extract `choices[0].message.content`
- **OpenRouter** — same as OpenAI-compat but default base URL `https://openrouter.ai/api/v1`
- **Ollama** — fetch to Ollama's `/api/chat` endpoint
- **Lemonade** — OpenAI-compat variant, same extraction logic

Implementation: a factory function `createSubAgent(config: SubModelConfig): SubAgentLLM` that switches on provider. Each branch is a thin wrapper — no shared code with the main model providers needed (these are simple single-shot calls).

### Fallback

If `[sub_model]` is not configured, create a `SubAgentLLM` that wraps the main `ModelProvider`:

```typescript
function wrapMainModel(model: ModelProvider, modelName: string, maxTokens: number): SubAgentLLM {
  return {
    async complete(prompt, system) {
      const response = await model.complete({
        messages: [{ role: 'user', content: prompt }],
        system,
        tools: [],
        model: modelName,
        max_tokens: Math.min(maxTokens, 8000),
      });
      // extract text from content blocks
      return response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    },
  };
}
```

This means no feature is gated on having a separate sub-model — compaction, titles, and summarize all work regardless. They just use the expensive model as a fallback.

### Wiring

In `src/index.ts`:
1. If `config.subModel` exists: `createSubAgent(config.subModel)`
2. Otherwise: `wrapMainModel(model, config.model.name, config.model.maxTokens)`
3. Pass into `AgentDependencies` as `subAgent: SubAgentLLM`

Add `subAgent?: SubAgentLLM` to `AgentDependencies` in `src/agent/types.ts`.

### Compaction Update

In `src/agent/compaction.ts`, update `summarizeOlderContext()`:
- Accept `subAgent: SubAgentLLM` instead of `model: ModelProvider` + `modelName` + `maxTokens`
- Call `subAgent.complete(combined, systemPrompt)` instead of `model.complete({...})`
- Simplifies the function signature and uses the cheaper model when available

### Consumers

- Compaction (`src/agent/compaction.ts`) — immediate
- Session titles (#5) — uses `deps.subAgent`
- Summarize tool (#8) — uses `deps.subAgent`

## Files Touched

- `src/config/types.ts` — add `SubModelConfig`, add to `AppConfig`
- `src/config/loader.ts` — parse `[sub_model]` section, env overrides
- `src/model/sub-agent.ts` — new file, factory + all five provider implementations
- `src/agent/types.ts` — add `subAgent?: SubAgentLLM` to `AgentDependencies`
- `src/agent/compaction.ts` — switch to sub-agent for summarization
- `src/index.ts` — create and wire sub-agent

## Acceptance Criteria

1. `SubAgentLLM` type exported with `complete(prompt, system?) → Promise<string>`
2. All five providers work: anthropic, openai-compat, openrouter, ollama, lemonade
3. Fallback wraps main model when `[sub_model]` not configured
4. Compaction uses sub-agent instead of main model
5. `subAgent` available on `AgentDependencies` for downstream consumers
6. Config: `SUB_MODEL_API_KEY` env var overrides TOML
7. Test: mock sub-agent returns expected text for each provider variant
