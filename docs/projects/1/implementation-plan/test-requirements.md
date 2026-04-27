# GH01: Graceful Max-Iteration Exhaustion — Test Requirements

Maps each acceptance criterion to automated tests. All tests are unit tests in `src/agent/agent.test.ts` using `bun:test`.

## Automated Tests

| AC ID | Criterion | Test Type | Test File | Test Description |
|-------|-----------|-----------|-----------|------------------|
| GH01.AC1.1 | System nudge appears in history on exhaustion | unit | `src/agent/agent.test.ts` | After model returns `tool_use` for all `maxToolRounds`, inspect history for user message containing `'[System: Max tool calls reached. Provide final response now.]'` |
| GH01.AC2.1 | Final call with `tools: []` produces text | unit | `src/agent/agent.test.ts` | Mock model returns text when `tools` is `[]`. Assert `ChatResult.text` matches the forced response text. Assert model was called with `tools: []` on the final call. |
| GH01.AC2.2 | Final call usage stats included in ChatStats | unit | `src/agent/agent.test.ts` | Mock model returns known usage values per call. Assert `stats.inputTokens` and `stats.outputTokens` equal the sum across all calls including the forced one. |
| GH01.AC2.3 | Rounds count includes final call | unit | `src/agent/agent.test.ts` | With `maxToolRounds: N`, assert `stats.rounds` equals `N + 1` when exhaustion occurs. |
| GH01.AC3.1 | Normal exit unaffected | unit | `src/agent/agent.test.ts` | Model returns `end_turn` immediately. Assert no nudge in history, `stats.rounds` equals 1, model called exactly once. |
| GH01.AC4.1 | Integration: always-tool_use model forced to text | unit | `src/agent/agent.test.ts` | End-to-end scenario: model returns `tool_use` until `tools: []`, then returns text. Verify returned text, correct round count, correct token sums. |

## Human Verification

None required. All acceptance criteria are testable via automated unit tests with mocked dependencies.
