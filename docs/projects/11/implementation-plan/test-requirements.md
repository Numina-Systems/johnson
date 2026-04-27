# GH11: Extended Thinking / Reasoning Content Preservation — Test Requirements

## Acceptance Criteria to Test Mapping

### Automated Tests

| AC | Description | Test Type | Test File | Notes |
|----|-------------|-----------|-----------|-------|
| GH11.AC1.1 | `ModelResponse` has `reasoning_content?: string` | Type check | N/A | Verified by TypeScript compiler (`tsc --noEmit`). No runtime test needed. |
| GH11.AC2.1 | `Message` has `reasoning_content?: string` | Type check | N/A | Verified by TypeScript compiler. No runtime test needed. |
| GH11.AC3.1 | Anthropic extracts thinking blocks | Type check | N/A | Structural — verified by compiler. Integration testing requires live Anthropic API with extended thinking enabled. |
| GH11.AC3.2 | Anthropic no-op when no thinking blocks | Type check | N/A | Field is optional, absence is the default. Compiler verifies. |
| GH11.AC4.1 | OpenRouter extracts reasoning | Type check | N/A | Structural — verified by compiler. Integration testing requires live OpenRouter API with reasoning model. |
| GH11.AC4.2 | OpenRouter no-op when no reasoning | Type check | N/A | Field is optional, absence is the default. |
| GH11.AC5.1 | OpenAI-compat extracts reasoning_content | Type check | N/A | Structural — verified by compiler. |
| GH11.AC5.2 | OpenAI-compat no-op when absent | Type check | N/A | Field is optional, absence is the default. |
| GH11.AC6.1 | Agent loop attaches reasoning to assistant message | Unit | `src/agent/agent.test.ts` | Mock model returns reasoning, verify it appears in history on next model call. |
| GH11.AC6.2 | Agent loop no-op when reasoning absent | Unit | `src/agent/agent.test.ts` | Mock model returns no reasoning, verify message has no `reasoning_content`. |
| GH11.AC7.1 | Compaction includes reasoning in formatted output | Unit | `src/agent/compaction.test.ts` | Direct test of `formatConversation` with a message containing `reasoning_content`. |
| GH11.AC7.2 | Compaction unchanged when no reasoning | Unit | `src/agent/compaction.test.ts` | Direct test of `formatConversation` without `reasoning_content` — output matches prior format. |
| GH11.AC9.1 | Test: mock model with reasoning, verify on assistant message | Unit | `src/agent/agent.test.ts` | Core behavioral test of the feature. |
| GH11.AC9.2 | Test: formatConversation includes reasoning | Unit | `src/agent/compaction.test.ts` | Core behavioral test of compaction serialization. |

### Human Verification

| AC | Description | Verification Approach |
|----|-------------|----------------------|
| GH11.AC8.1 | No display in TUI | Verify no TUI files were modified. Run `git diff --name-only` after implementation and confirm no files under `src/tui/` appear. |
| GH11.AC3.1 (integration) | Anthropic thinking blocks extracted in production | Manually test with a Claude model that supports extended thinking. Set `reasoning: high` in config, send a request, inspect debug logs for reasoning content. |
| GH11.AC4.1 (integration) | OpenRouter reasoning extracted in production | Manually test with an OpenRouter model that returns reasoning. Inspect debug logs. |

## Test Execution

```bash
# Run all tests
cd /Users/scarndp/dev/johnson/.worktrees/GH11 && bun test

# Run specific test files
bun test src/agent/agent.test.ts
bun test src/agent/compaction.test.ts

# Type checking (covers AC1-AC5 structurally)
npx tsc --noEmit
```

## Summary

- **4 automated unit tests** across 2 test files
- **Type checking** covers the structural correctness of all provider changes (AC1-AC5)
- **3 human verification items** for TUI non-impact and live integration testing
- Provider extraction logic (AC3-AC5) is structural — the code either sets the field from the API response or doesn't. The extraction patterns are straightforward conditional reads with no branching logic that warrants mocking the HTTP layer.
