# GH08: Summarization Tool — Test Requirements

## Acceptance Criteria to Test Mapping

| AC ID | Criterion | Test Type | Test File | Automated? |
|-------|-----------|-----------|-----------|------------|
| GH08.AC1.1 | `summarize` sends text to sub-agent with appropriate system prompt | Unit | `src/tools/summarize.test.ts` | Yes |
| GH08.AC2.1 | Input truncated at 100k chars | Unit | `src/tools/summarize.test.ts` | Yes |
| GH08.AC3.1 | `max_length` maps to correct length guidance | Unit | `src/tools/summarize.test.ts` | Yes |
| GH08.AC4.1 | Optional `instructions` appended to prompt as focus guidance | Unit | `src/tools/summarize.test.ts` | Yes |
| GH08.AC5.1 | Missing sub-agent produces clear error message | Unit | `src/tools/summarize.test.ts` | Yes |
| GH08.AC6.1 | Registered as `mode: 'both'` — native tool_use + sandbox stubs | Unit | `src/tools/summarize.test.ts` | Yes (verify via registry inspection after registration) |

## Human Verification

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| GH08.AC6.1 (partial) | Tool actually appears in both native tool_use list AND sandbox stubs at runtime | Full end-to-end with a real model requires a running agent | Start agent with `bun start`, send a message asking to summarize something, verify it works both as native tool call and in execute_code |

## Test Design Notes

- All automated tests use a mock `SubAgentLLM` that captures `prompt` and `system` arguments
- No real LLM calls are made in tests
- The mock returns a fixed string; tests assert on prompt construction, not on LLM output quality
- Truncation test uses a 200k character string and verifies the prompt stays under ~100.2k (100k text + instruction overhead)
- Length guidance tests verify each of the three variants plus the default (no `max_length` specified)
- Instructions test verifies both presence (when provided) and absence (when omitted) of the `Focus:` line
- Error test verifies the thrown error message text, not just that an error is thrown
- Registration mode test: after calling `registerSummarizeTools`, inspect the registry to confirm the tool is registered. If #3 exposes a way to query tool mode or if `generateToolDefinitions()` includes it, use that to verify `mode: 'both'`. Otherwise, verify the tool appears in both `generateToolDefinitions()` output (native) and `generateTypeScriptStubs()` output (sandbox).
