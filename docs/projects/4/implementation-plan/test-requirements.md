# Sub-Agent LLM -- Test Requirements

Derived from the Acceptance Criteria in `docs/projects/4/design.md`.

## Automated Tests

| AC | Criterion | Test Type | Test File | Description |
|----|-----------|-----------|-----------|-------------|
| GH04.AC1.1 | `SubAgentLLM` type exported | Unit | `src/model/sub-agent.test.ts` | Type is importable and used to create sub-agent instances |
| GH04.AC2.1 | Anthropic provider works | Unit | `src/model/sub-agent.test.ts` | Mock Anthropic SDK, verify text extraction from messages API response |
| GH04.AC2.2 | OpenAI-compat provider works | Unit | `src/model/sub-agent.test.ts` | Mock fetch, verify text extraction from `choices[0].message.content` |
| GH04.AC2.3 | OpenRouter provider works | Unit | `src/model/sub-agent.test.ts` | Mock fetch, verify correct base URL and text extraction |
| GH04.AC2.4 | Ollama provider works | Unit | `src/model/sub-agent.test.ts` | Mock fetch, verify `/api/chat` endpoint and `message.content` extraction |
| GH04.AC2.5 | Lemonade provider works | Unit | `src/model/sub-agent.test.ts` | Mock fetch, verify delegates to OpenAI-compat pattern |
| GH04.AC3.1 | Fallback wraps main model | Unit | `src/model/sub-agent.test.ts` | Mock ModelProvider, verify `tools: []` and text extraction |
| GH04.AC3.2 | Fallback caps max_tokens | Unit | `src/model/sub-agent.test.ts` | Verify `max_tokens` capped at 8000 regardless of input |
| GH04.AC4.1 | Compaction uses sub-agent | Unit | `src/agent/compaction.test.ts` | Mock SubAgentLLM, verify `complete()` called during compaction |
| GH04.AC6.1 | Env var overrides TOML | Unit | `src/config/loader.test.ts` | Set `SUB_MODEL_API_KEY` env var, verify it overrides TOML value |
| GH04.AC6.2 | Missing config returns undefined | Unit | `src/config/loader.test.ts` | Load config without `[sub_model]`, verify `subModel` is `undefined` |
| GH04.AC7.1 | Mock returns expected text | Unit | `src/model/sub-agent.test.ts` | Each provider test verifies returned string matches mock |

## Human Verification

| AC | Criterion | Verification Approach |
|----|-----------|----------------------|
| GH04.AC5.1 | `subAgent` on AgentDependencies | Code review: verify field exists on type. TypeScript compiler enforces usage. |
| GH04.AC5.2 | Sub-agent wired in index.ts | Code review: verify `createSubAgent`/`wrapMainModel` called and result passed to `agentDeps`. Manual smoke test: start agent, trigger compaction, verify logs show sub-agent activity. |

**Justification for human verification:** GH04.AC5 concerns wiring in `src/index.ts` which requires a running config file, database, and model API keys to exercise end-to-end. The type system enforces correctness at compile time; manual smoke testing confirms runtime behavior.

## Test Runner

All tests use `bun test` (Bun's built-in test runner). No additional test framework is needed.

## Test Files Summary

| File | Tests | Covers |
|------|-------|--------|
| `src/model/sub-agent.test.ts` | ~12 | AC1, AC2, AC3, AC7 |
| `src/config/loader.test.ts` | ~4 | AC6 |
| `src/agent/compaction.test.ts` | ~2 | AC4 |
