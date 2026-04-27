# GH11: Extended Thinking / Reasoning Content Preservation — Phase 2

**Goal:** Extract reasoning content from each model provider's API response and set it on the `ModelResponse`.

**Architecture:** Each provider has a different response format for reasoning. Anthropic returns `thinking` content blocks. OpenRouter surfaces a `reasoning` string on the assistant message. OpenAI-compat may include reasoning in the response (o1-style models). Ollama does not emit reasoning — no-op. Each provider extracts and concatenates reasoning text into the single `reasoning_content` string field added in Phase 1.

**Tech Stack:** TypeScript strict mode, Bun runtime, `@anthropic-ai/sdk` (v0.39+), `@openrouter/sdk` (v0.12+)

**Scope:** 3 phases total (this is phase 2 of 3)

**Codebase verified:** 2026-04-27 via direct investigation

---

## Acceptance Criteria Coverage

This phase implements:

### GH11.AC3: Anthropic provider extracts thinking blocks into reasoning_content
- **GH11.AC3.1 Success:** When Claude returns `thinking` content blocks, they are concatenated into `reasoning_content` on the `ModelResponse`
- **GH11.AC3.2 No-op:** When no thinking blocks are present, `reasoning_content` is `undefined`

### GH11.AC4: OpenRouter provider extracts reasoning metadata
- **GH11.AC4.1 Success:** When OpenRouter response includes `reasoning` on the assistant message, it is set as `reasoning_content`
- **GH11.AC4.2 No-op:** When `reasoning` is absent/null, `reasoning_content` is `undefined`

### GH11.AC5: OpenAI-compat / lemonade providers extract reasoning if present
- **GH11.AC5.1 Success:** When response includes a `reasoning_content` field on the message, it is extracted
- **GH11.AC5.2 No-op:** When field is absent, `reasoning_content` is `undefined`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Anthropic provider — extract thinking blocks

**Verifies:** GH11.AC3.1, GH11.AC3.2

**Files:**
- Modify: `src/model/anthropic.ts:23-37` (mapContentBlock function)
- Modify: `src/model/anthropic.ts:70-89` (complete function, response mapping + return)

**Implementation:**

The Anthropic SDK's `ContentBlock` union already includes `ThinkingBlock` (`{ type: 'thinking'; thinking: string; signature: string }`) and `RedactedThinkingBlock` (`{ type: 'redacted_thinking' }`). The current `mapContentBlock` function has a fallback for unknown block types but does not handle `thinking` explicitly.

Two changes needed:

**1. Update `mapContentBlock` to skip thinking blocks.**

Thinking blocks should not be mapped into the agent's `ContentBlock[]` — they are metadata, not content the agent acts on. The function currently falls through to a text fallback for unknown types. Add an explicit case that returns `null` for thinking blocks, and filter nulls from the result.

Replace the current `mapContentBlock` and the line that calls it:

```typescript
function mapContentBlock(block: Anthropic.ContentBlock): ContentBlock | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return null;
  }
  // Fallback: treat unknown block types as text
  return { type: 'text', text: String((block as unknown as Record<string, unknown>)['text'] ?? '') };
}
```

Update the content mapping in `complete()` (currently line 74):

```typescript
const content: Array<ContentBlock> = response.content
  .map(mapContentBlock)
  .filter((b): b is ContentBlock => b !== null);
```

**2. Extract reasoning content from thinking blocks.**

After the content mapping, concatenate all `thinking` block text into `reasoning_content`:

```typescript
const thinkingTexts = response.content
  .filter((b): b is Anthropic.ThinkingBlock => b.type === 'thinking')
  .map((b) => b.thinking);
const reasoning_content = thinkingTexts.length > 0
  ? thinkingTexts.join('\n\n')
  : undefined;
```

Then include it in the return:

```typescript
return {
  content,
  stop_reason: mapStopReason(response.stop_reason),
  usage: {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens:
      (response.usage as unknown as Record<string, unknown>)['cache_creation_input_tokens'] as
        number | null | undefined ?? null,
    cache_read_input_tokens:
      (response.usage as unknown as Record<string, unknown>)['cache_read_input_tokens'] as
        number | null | undefined ?? null,
  },
  reasoning_content,
};
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors.

**Commit:** `feat(anthropic): extract thinking blocks into reasoning_content`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: OpenRouter provider — extract reasoning field

**Verifies:** GH11.AC4.1, GH11.AC4.2

**Files:**
- Modify: `src/model/openrouter.ts:223-237` (return statement in complete function)

**Implementation:**

The OpenRouter SDK's `ChatAssistantMessage` type includes `reasoning?: string | null | undefined`. The current code accesses `choice.message` but does not read `reasoning`.

After the existing debug log line (line 228), extract the reasoning:

```typescript
const reasoning_content = typeof choice.message.reasoning === 'string' && choice.message.reasoning.length > 0
  ? choice.message.reasoning
  : undefined;
```

Then include it in the return object (currently lines 230-237):

```typescript
return {
  content: mapResponseContent(choice.message),
  stop_reason: mapFinishReason(choice.finishReason),
  usage: {
    input_tokens: response.usage?.promptTokens ?? 0,
    output_tokens: response.usage?.completionTokens ?? 0,
  },
  reasoning_content,
};
```

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors.

**Commit:** `feat(openrouter): extract reasoning into reasoning_content`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: OpenAI-compat provider — extract reasoning if present

**Verifies:** GH11.AC5.1, GH11.AC5.2

**Files:**
- Modify: `src/model/openai-compat.ts:34-45` (OpenAIChoice type)
- Modify: `src/model/openai-compat.ts:270-281` (return statement in complete function)

**Implementation:**

Some OpenAI-compatible providers (e.g., o1-style models, DeepSeek-R1 via compatible endpoints) return reasoning in the response. The field name varies but the most common convention is `reasoning_content` on the message object. The current `OpenAIChoice` type does not include this field.

**1. Extend the `OpenAIChoice` type** to accept an optional reasoning field on the message:

```typescript
type OpenAIChoice = {
  message: {
    role: 'assistant';
    content: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
};
```

**2. Extract reasoning in the return.** After getting `choice` (line 272), extract reasoning:

```typescript
const reasoning_content = typeof choice.message.reasoning_content === 'string' && choice.message.reasoning_content.length > 0
  ? choice.message.reasoning_content
  : undefined;
```

Include in the return:

```typescript
return {
  content: mapResponseContent(choice),
  stop_reason: mapFinishReason(choice.finish_reason),
  usage: {
    input_tokens: data.usage.prompt_tokens,
    output_tokens: data.usage.completion_tokens,
  },
  reasoning_content,
};
```

**Note:** This also covers the `lemonade` provider case from the design — there is no separate `src/model/lemonade.ts` file. Lemonade uses the OpenAI-compat provider, so this change covers both.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors.

**Commit:** `feat(openai-compat): extract reasoning_content from response`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Ollama provider — verify no-op

**Verifies:** None (verification that existing provider doesn't crash with the new optional field)

**Files:**
- No modifications to `src/model/ollama.ts`

**Implementation:**

No code changes. The Ollama provider's `complete()` method returns a `ModelResponse` without `reasoning_content`, which is valid because the field is optional. Local models served by Ollama do not emit reasoning content.

**Verification:**

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH11 && npx tsc --noEmit`
Expected: No type errors. The Ollama provider compiles cleanly without setting `reasoning_content` because the field is optional on `ModelResponse`.

No commit needed for this task — it's a verification step only.

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
