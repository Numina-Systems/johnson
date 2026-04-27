# GH02: Event Emission / Lifecycle Hooks — Test Requirements

## Acceptance Criteria to Test Mapping

### GH02.AC1: AgentEvent and AgentEventKind types exported

| AC | Verification | Type | Notes |
|----|-------------|------|-------|
| GH02.AC1.1 | TypeScript compiler (`tsc --noEmit`) | Compile-time | String literal union verified by type system |
| GH02.AC1.2 | TypeScript compiler (`tsc --noEmit`) | Compile-time | Readonly fields verified by type system |
| GH02.AC1.3 | TypeScript compiler (`tsc --noEmit`) | Compile-time | Import from `src/agent/index.ts` verified by build |

**Justification for no unit tests:** These are pure type declarations. The TypeScript compiler in strict mode verifies their structure. Type-only exports are verified by the build succeeding.

### GH02.AC2: onEvent callback on ChatOptions is optional

| AC | Verification | Type | Notes |
|----|-------------|------|-------|
| GH02.AC2.1 | TypeScript compiler (`tsc --noEmit`) | Compile-time | Optional field type checked by compiler |
| GH02.AC2.2 | TypeScript compiler (`tsc --noEmit`) + existing callers | Compile-time | Existing call sites omit `onEvent` and must compile |

**Justification for no unit tests:** Optionality is a type-level property. If existing callers compile without providing `onEvent`, the criterion is met. The build gate covers this.

### GH02.AC3: All four events fire in order

| AC | Verification | Type | File |
|----|-------------|------|------|
| GH02.AC3.1 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |
| GH02.AC3.2 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |

- **GH02.AC3.1:** Mock model returns `tool_use` then `end_turn`. Assert event sequence `[llm_start, llm_done, tool_start, tool_done, llm_start, llm_done]`.
- **GH02.AC3.2:** The same test covers this — the second model call (end_turn round) emits `llm_start` and `llm_done` without tool events.

### GH02.AC4: Callback errors are logged, not thrown

| AC | Verification | Type | File |
|----|-------------|------|------|
| GH02.AC4.1 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |
| GH02.AC4.2 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |

- **GH02.AC4.1:** Provide `onEvent` that throws. Assert `chat()` resolves (does not reject).
- **GH02.AC4.2:** Same test — assert `ChatResult.text` is non-empty.

### GH02.AC5: Code preview in tool_start truncated to 500 chars

| AC | Verification | Type | File |
|----|-------------|------|------|
| GH02.AC5.1 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |

- **GH02.AC5.1:** Mock model submits code > 500 chars. Assert `tool_start` event's `data.code` has `length <= 500`.

### GH02.AC6: Result preview in tool_done truncated to 200 chars

| AC | Verification | Type | File |
|----|-------------|------|------|
| GH02.AC6.1 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |

- **GH02.AC6.1:** Mock runtime returns output > 200 chars. Assert `tool_done` event's `data.preview` has `length <= 200`.

### GH02.AC7: Integration test verifies full event sequence

| AC | Verification | Type | File |
|----|-------------|------|------|
| GH02.AC7.1 | Automated test | Unit (with mocks) | `src/agent/agent.test.ts` |

- **GH02.AC7.1:** This is the primary test (same as GH02.AC3.1). Provides `onEvent`, runs `chat()` with mocked tool-use round, verifies all four kinds fire in order.

## Human Verification Required

None. All acceptance criteria are either compiler-verified or covered by automated tests.

## Test Infrastructure Notes

- This is the project's first test file. Uses `bun:test` (built-in).
- No existing test patterns to follow — this test establishes the pattern.
- Mock strategy: inline mock objects implementing `ModelProvider`, `CodeRuntime`, and minimal `Store` stubs.
- Persona file: create a temp file in `beforeAll` via `Bun.write`.
