# Sub-Agent LLM Implementation Plan -- Phase 1: Config Types and TOML Loader

**Goal:** Add `SubModelConfig` type and `[sub_model]` TOML parsing so the sub-agent can be configured independently of the main model.

**Architecture:** Extends the existing config layer (`src/config/types.ts` + `src/config/loader.ts`) with a new optional `subModel` field on `AppConfig`. The loader parses a `[sub_model]` TOML section using the same `pick()` helper pattern as the main `[model]` section. Environment variable overrides follow the existing `resolveApiKey`/`resolveBaseUrl` pattern with `SUB_MODEL_` prefixed env vars.

**Tech Stack:** TypeScript, TOML (via `toml` package), Bun runtime

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH04.AC1: SubAgentLLM type exported with `complete(prompt, system?) -> Promise<string>`
- **GH04.AC1.1 Success:** `SubModelConfig` type defined and added to `AppConfig` (type only -- implementation in Phase 2)

### GH04.AC6: Config: `SUB_MODEL_API_KEY` env var overrides TOML
- **GH04.AC6.1 Success:** `[sub_model]` TOML section parsed with env var overrides for `SUB_MODEL_API_KEY`, `SUB_MODEL_BASE_URL`, `SUB_MODEL_NAME`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `SubModelConfig` type to `src/config/types.ts`

**Verifies:** GH04.AC1.1

**Files:**
- Modify: `src/config/types.ts` (add type after `ModelConfig`, add field to `AppConfig`)

**Implementation:**

Add the `SubModelConfig` type after the existing `ModelConfig` type (after line 12). It reuses the same provider union as `ModelConfig`:

```typescript
export type SubModelConfig = {
  readonly provider: 'anthropic' | 'openai-compat' | 'openrouter' | 'ollama' | 'lemonade';
  readonly name: string;
  readonly maxTokens: number;
  readonly baseUrl?: string;
  readonly apiKey?: string;
};
```

Add `subModel` as an optional field to `AppConfig`:

```typescript
export type AppConfig = {
  readonly model: ModelConfig;
  readonly runtime: RuntimeConfig;
  readonly agent: AgentLoopConfig;
  readonly embedding?: EmbeddingConfig;
  readonly discord?: DiscordConfig;
  readonly interface: InterfaceMode;
  readonly subModel?: SubModelConfig;
};
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(config): add SubModelConfig type to AppConfig`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Parse `[sub_model]` TOML section in `src/config/loader.ts`

**Verifies:** GH04.AC6.1

**Files:**
- Modify: `src/config/loader.ts` (update `RawConfig` type, add parsing block, update import, update return)

**Implementation:**

1. Update the `RawConfig` type to include `sub_model`:

```typescript
type RawConfig = {
  model?: Partial<ModelConfig> & Record<string, unknown>;
  runtime?: Partial<RuntimeConfig> & Record<string, unknown>;
  agent?: Partial<AgentLoopConfig> & Record<string, unknown>;
  embedding?: Partial<EmbeddingConfig> & Record<string, unknown>;
  discord?: Partial<DiscordConfig> & Record<string, unknown>;
  sub_model?: Partial<SubModelConfig> & Record<string, unknown>;
  interface?: string;
};
```

2. Add `SubModelConfig` to the import from `./types.ts`.

3. Add a parsing block after the `discord` section (before the `rawInterface` line) that checks whether `raw.sub_model` exists OR env vars are set. If a sub-model provider is detected, build the `SubModelConfig`. The env var resolution follows the existing pattern:

```typescript
// Sub-model config (optional -- for cheaper LLM calls in compaction, titles, etc.)
const subModelProvider = process.env['SUB_MODEL_PROVIDER']
  ?? pick(raw.sub_model, 'provider', undefined);

const subModel: SubModelConfig | undefined = subModelProvider
  ? {
      provider: subModelProvider as SubModelConfig['provider'],
      name: process.env['SUB_MODEL_NAME']
        ?? pick(raw.sub_model, 'name', 'claude-haiku-4-5-20251001'),
      maxTokens: pick(raw.sub_model, 'maxTokens', 8000),
      apiKey: process.env['SUB_MODEL_API_KEY']
        ?? resolveApiKey(subModelProvider, pick(raw.sub_model, 'apiKey', undefined)),
      baseUrl: process.env['SUB_MODEL_BASE_URL']
        ?? resolveBaseUrl(subModelProvider, pick(raw.sub_model, 'baseUrl', undefined)),
    }
  : undefined;
```

Note: `resolveApiKey` and `resolveBaseUrl` already handle provider-specific defaults (e.g., Anthropic falls back to `ANTHROPIC_API_KEY`, OpenRouter defaults base URL to `https://openrouter.ai/api/v1`). The sub-model reuses these, with `SUB_MODEL_API_KEY` and `SUB_MODEL_BASE_URL` taking priority when set.

4. Update the return statement to include `subModel`:

```typescript
return { model, runtime, agent, embedding, discord, interface: interfaceMode, subModel };
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(config): parse [sub_model] TOML section with env var overrides`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
