# GH12: Dynamic System Prompt Provider - Test Requirements

## Automated Tests

| AC | Criterion | Test Type | Test File | Description |
|----|-----------|-----------|-----------|-------------|
| GH12.AC1.1 | Provider receives toolDocs and returns the complete system prompt | Unit | `src/agent/agent.test.ts` | Construct agent with provider, call `chat()`, assert model received the provider's return value as `system` param |
| GH12.AC2.1 | Provider failure falls back to cached last-good prompt with stderr warning | Unit | `src/agent/agent.test.ts` | Call `chat()` twice: first with working provider (populates cache), second with throwing provider; assert model received cached prompt on second call |
| GH12.AC3.1 | Existing behaviour preserved when no provider is set | Compiler | N/A | The `systemPromptProvider` field is optional. When absent, `_chatImpl` takes the `else` branch which is identical to the pre-change code. Verified by: code review of the `else` branch + TypeScript compilation |
| GH12.AC4.1 | src/index.ts wires a default provider | Compiler + Code review | N/A | Verified by TypeScript compilation (type mismatch would fail) and code review that the provider calls `buildSystemPrompt` with the same arguments as the previous inline code |
| GH12.AC5.1 | New features can extend the provider without touching agent.ts | Structural | N/A | Verified by code review: the provider function lives in `src/index.ts`, future features add context there |
| GH12.AC6.1 | Test: provider that throws -> verify fallback to cached prompt | Unit | `src/agent/agent.test.ts` | Same as GH12.AC2.1 |
| GH12.AC7.1 | Test: provider returns custom prompt -> verify it's used in model call | Unit | `src/agent/agent.test.ts` | Same as GH12.AC1.1 |

## Human Verification

| AC | Criterion | Justification | Verification Approach |
|----|-----------|---------------|----------------------|
| GH12.AC3.1 | Existing behaviour preserved when no provider is set | Requires verifying that the fallback code path is byte-for-byte identical to the original. An automated test would need a real persona file + store with data, which is an integration test beyond the scope of this feature. | Code review: compare the `else` branch in the modified `_chatImpl` against the original lines 95-106 and confirm they are identical |
| GH12.AC5.1 | New features can extend the provider without touching agent.ts | This is an architectural property, not a runtime behaviour. | Code review: confirm the provider is defined in `src/index.ts` and the agent loop in `agent.ts` only calls the provider without knowing what data sources feed it |
