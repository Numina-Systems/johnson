# #11 — Extended Thinking / Reasoning Content Preservation

**Issue:** https://github.com/Numina-Systems/johnson/issues/11
**Wave:** 0 (no dependencies)

## Current State

OpenRouter config supports `reasoning` effort level (`none | low | medium | high`), but reasoning content from model responses is discarded. Not stored in conversation history, not available for compaction or debugging.

## Design

### Approach: Field on Message (Option A)

Add `reasoning_content?: string` directly to the `Message` type. This is metadata that most consumers can ignore. The `Message` type is internal, not an API contract.

### Model Response

Add `reasoning_content?: string` to `ModelResponse` in `src/model/types.ts`. Each provider extracts it from the raw API response.

### Provider Changes

**`src/model/anthropic.ts`**
- Claude returns thinking as `thinking` content blocks in the response
- Concatenate all `thinking` block text into a single `reasoning_content` string
- Set on the `ModelResponse`

**`src/model/openrouter.ts`**
- OpenRouter surfaces reasoning in response metadata (varies by underlying model)
- Extract from the response if present

**`src/model/openai-compat.ts`**
- o1-style models may include reasoning tokens
- Extract if present in the response structure

**`src/model/ollama.ts`**
- Local models don't emit reasoning content
- No-op — leave `reasoning_content` undefined

**`src/model/lemonade.ts`** (if separate from openai-compat)
- Same treatment as openai-compat — extract reasoning if present in the response
- Lemonade is an OpenAI-compat variant, so the extraction logic should mirror that provider

### Agent Loop

In `src/agent/agent.ts`, after building `assistantMessage` (line ~177):
- Check `response.reasoning_content`
- If present, attach to the message: `assistantMessage.reasoning_content = response.reasoning_content`

### Compaction

In `src/agent/compaction.ts` `formatConversation()`:
- When serializing assistant messages, include reasoning content if present
- Format as: `### assistant (reasoning)\n{reasoning_content}\n### assistant\n{content}`
- This lets the summarizer see why decisions were made

### Message Serialization

In `src/agent/messages.ts`:
- When serializing messages to/from store, preserve the `reasoning_content` field
- JSON serialization handles this naturally if the field exists

## Files Touched

- `src/model/types.ts` — add `reasoning_content?: string` to `ModelResponse` and `Message`
- `src/model/anthropic.ts` — extract from thinking blocks
- `src/model/openrouter.ts` — extract from response metadata
- `src/model/openai-compat.ts` — extract if present (covers lemonade)
- `src/model/ollama.ts` — no-op (verify no crash if field absent)
- `src/agent/agent.ts` — attach reasoning to assistant message
- `src/agent/compaction.ts` — include reasoning in formatted conversation

## Acceptance Criteria

1. `ModelResponse` has optional `reasoning_content` field
2. `Message` has optional `reasoning_content` field
3. Anthropic provider extracts thinking blocks into `reasoning_content`
4. OpenRouter provider extracts reasoning metadata
5. OpenAI-compat / lemonade providers extract reasoning if present
6. Agent loop attaches reasoning to assistant messages in history
7. Compaction serializer includes reasoning content when formatting
8. No display in TUI (preserved in data only)
9. Test: mock model response with reasoning → verify stored on assistant message in history
