# GH03: Multi-Tool Architecture — Test Requirements

## Acceptance Criteria to Test Mapping

| AC ID | Criterion | Test Type | Test File | Phase |
|-------|-----------|-----------|-----------|-------|
| GH03.AC1.1 | Registry supports `mode: 'sandbox' \| 'native' \| 'both'` per tool | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC1.2 | `generateToolDefinitions()` returns only native/both-mode tools | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC1.3 | `generateTypeScriptStubs()` generates stubs for only sandbox/both-mode tools | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC1.4 | `generateToolDocumentation()` documents all tools regardless of mode | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC1.5 | Existing tools unaffected — all 8 remain sandbox-only | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC5.1 | Agent loop dispatches native tools directly through registry | Integration | `src/agent/agent.test.ts` | 4 |
| GH03.AC6.1 | Agent loop still dispatches `execute_code` through Deno sandbox | Integration | `src/agent/agent.test.ts` | 4 |
| GH03.AC7.1 | `ToolResultBlock.content` supports `string \| Array<ContentBlock>` | Unit | `src/model/types.test.ts` | 2 |
| GH03.AC9.1 | Register native tool → appears in `generateToolDefinitions()` but not in stubs | Unit | `src/runtime/tool-registry.test.ts` | 1 |
| GH03.AC10.1 | Mock model returns native tool_use → registry.execute called directly | Integration | `src/agent/agent.test.ts` | 4 |
| GH03.AC11.1 | Mock model returns `execute_code` → Deno sandbox path unchanged | Integration | `src/agent/agent.test.ts` | 4 |

## Human Verification Required

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| GH03.AC8.1 | Existing tools unaffected — all 8 remain sandbox-only | Requires reading `src/agent/tools.ts` and confirming no mode arguments added. Partially covered by AC1.5 unit test (default mode is sandbox), but full verification requires human review that no `register()` calls were changed. | Inspect `src/agent/tools.ts` — confirm all `register()` calls have 3 arguments (no 4th `mode` arg). Run `bun start` and verify basic agent functionality (document operations, skill listing) still works. |

## Test Infrastructure Notes

- **Test runner:** Bun's built-in test runner (`bun test`). Discovers `*.test.ts` files automatically.
- **No existing tests:** This feature introduces the first test files to the project. Tests use `import { describe, it, expect } from 'bun:test'`.
- **No mocking framework:** Use manual mock implementations. Bun supports `mock()` from `bun:test` for function mocking if needed.
- **Integration tests:** Agent loop tests require mock `ModelProvider`, `CodeRuntime`, and `Store`. Use an in-memory SQLite database (via the real `createStore()`) for the Store mock to avoid mocking the full interface. Write temp files for persona path.
