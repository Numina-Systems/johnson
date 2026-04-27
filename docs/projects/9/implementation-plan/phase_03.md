# Image Viewing Tool Implementation Plan — Phase 3: Agent Loop Integration

**Goal:** Wire the `view_image` tool's `ImageResult` return value into the agent loop so that image data is formatted as a multi-content `ToolResultBlock` (text + image block) that the model can see.

**Architecture:** Add a `formatNativeToolResult()` helper in `src/agent/agent.ts` that detects `ImageResult` objects and formats them as `ToolResultBlock` with an array content field containing both a text block and an `ImageSourceBlock`. Non-image results stringify normally. This helper is called from the native tool dispatch branch that #3 added.

**Tech Stack:** TypeScript, Bun runtime

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2025-04-27

**Prerequisite:** Phase 2 (tool implementation) must be complete. #3 must be merged (native dispatch branch in agent loop, widened `ToolResultBlock.content`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH09.AC4: Agent loop formats image result as multi-content ToolResultBlock (text + image block)
- **GH09.AC4.1 Success:** `formatNativeToolResult` with `ImageResult` input produces `ToolResultBlock` with content array containing text and image blocks
- **GH09.AC4.2:** Text block contains the descriptive text from `ImageResult.text`
- **GH09.AC4.3:** Image block contains correct `source.type`, `source.media_type`, and `source.data`

### GH09.AC5: Non-image results stringify normally
- **GH09.AC5.1:** String result passed to `formatNativeToolResult` produces `ToolResultBlock` with string content
- **GH09.AC5.2:** Object result produces `ToolResultBlock` with JSON-stringified content

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Implement formatNativeToolResult helper

**Verifies:** GH09.AC4.1, GH09.AC4.2, GH09.AC4.3, GH09.AC5.1, GH09.AC5.2

**Files:**
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/agent/agent.ts`

**Implementation:**

Add a `formatNativeToolResult` function to `src/agent/agent.ts`. This is a pure function (no side effects) that takes a tool_use ID and the raw result from a native tool handler, and returns a properly formatted `ToolResultBlock`.

Place it as a module-level function above `createAgent`, since it doesn't need closure state:

```typescript
import type { ImageSourceBlock } from '../model/types.ts';

function isImageResult(value: unknown): value is { type: 'image_result'; text: string; image: { type: 'base64'; media_type: string; data: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['type'] === 'image_result' &&
    typeof (value as Record<string, unknown>)['text'] === 'string' &&
    typeof (value as Record<string, unknown>)['image'] === 'object'
  );
}

function formatNativeToolResult(toolUseId: string, result: unknown): ToolResultBlock {
  if (isImageResult(result)) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        { type: 'text', text: result.text },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: result.image.media_type,
            data: result.image.data,
          },
        } satisfies ImageSourceBlock,
      ],
    };
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { type: 'tool_result', tool_use_id: toolUseId, content: text };
}
```

Key design decisions:
- **Type guard over import:** `isImageResult` uses structural duck-typing rather than importing `ImageResult` from `src/tools/image.ts`. This avoids coupling the agent loop to a specific tool module. Any tool that returns `{ type: 'image_result', text, image }` will get image formatting.
- **`satisfies ImageSourceBlock`:** Ensures the image block conforms to the type at compile time without a runtime cast.
- **Exported for testing:** Export `formatNativeToolResult` so it can be unit-tested directly. Add `export` to the function declaration.

Then, in the native dispatch branch of the tool loop (added by #3), use `formatNativeToolResult` instead of the default string-based formatting. The #3 native dispatch branch currently looks roughly like:

```typescript
} else {
  // native tool: dispatch directly through registry
  const result = await registry.execute(block.name, block.input);
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { type: 'tool_result', tool_use_id: block.id, content: text };
}
```

Replace the result formatting with:

```typescript
} else {
  // native tool: dispatch directly through registry
  try {
    const result = await registry.execute(block.name, block.input as Record<string, unknown>);
    return formatNativeToolResult(block.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: 'tool_result', tool_use_id: block.id, content: `Tool error: ${message}`, is_error: true };
  }
}
```

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors.

**Commit:** `feat(agent): add formatNativeToolResult with image content block support`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Handle image content blocks in context trimming

**Verifies:** GH09.AC4.1 (image blocks must survive in recent messages but be trimmable in older ones)

**Files:**
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/agent/context.ts`

**Implementation:**

The existing `trimOldToolResults` function in `src/agent/context.ts` already handles stripping `image_url` blocks from older user messages (line 152-158). However, after #3, `ToolResultBlock.content` can be an array containing `ImageSourceBlock` entries. The current code at line 165 skips non-string content:

```typescript
if (typeof content !== 'string') continue;
```

This means image-containing tool results (where `content` is an array) will never be trimmed, potentially bloating context with stale base64 image data.

Update `trimOldToolResults` to handle array-valued tool result content. When trimming an older tool result whose `content` is an array, replace it with a placeholder string describing what was removed:

```typescript
if (block.type !== 'tool_result') continue;

const content = block.content;

// Handle array content (e.g., image tool results with [text, image] blocks)
if (Array.isArray(content)) {
  const hasImage = content.some(
    (b: Record<string, unknown>) => b['type'] === 'image' || b['type'] === 'image_url'
  );
  if (hasImage) {
    (msg.content as Array<ContentBlock>)[j] = {
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: '[image tool result trimmed for context savings]',
    };
    trimmed++;
  }
  continue;
}

if (typeof content !== 'string') continue;
```

Insert this block after the `if (block.type !== 'tool_result') continue;` check (line 162) and before the existing `const content = block.content;` line. This ensures array-content tool results are trimmed in older messages while recent ones (within `TOOL_RESULT_PRESERVE_COUNT`) are preserved.

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors.

**Commit:** `feat(context): trim image tool results from older messages to save context`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for formatNativeToolResult and context trimming

**Verifies:** GH09.AC4.1, GH09.AC4.2, GH09.AC4.3, GH09.AC5.1, GH09.AC5.2

**Files:**
- Create: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/agent/agent.test.ts`

**Testing:**

Tests for `formatNativeToolResult` (exported from `agent.ts`) and for the updated `trimOldToolResults` behavior with array-content tool results.

The test file should cover these scenarios:

**formatNativeToolResult tests:**

- **GH09.AC4.1 (image result formatting):** Pass an `ImageResult`-shaped object (`{ type: 'image_result', text: 'Image from https://example.com/photo.png', image: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' } }`) and a tool_use_id. Verify the returned `ToolResultBlock` has:
  - `type: 'tool_result'`
  - `tool_use_id` matching the input
  - `content` that is an array of length 2

- **GH09.AC4.2 (text block content):** Same result as above. Verify `content[0]` is `{ type: 'text', text: 'Image from https://example.com/photo.png' }`.

- **GH09.AC4.3 (image block content):** Same result as above. Verify `content[1]` has `type: 'image'` and `source` with `type: 'base64'`, correct `media_type`, and correct `data`.

- **GH09.AC5.1 (string result):** Pass a plain string `'Document saved: foo'` as result. Verify `ToolResultBlock.content` is the string `'Document saved: foo'`.

- **GH09.AC5.2 (object result):** Pass an object `{ count: 3, items: ['a', 'b', 'c'] }` as result. Verify `ToolResultBlock.content` is `JSON.stringify({ count: 3, items: ['a', 'b', 'c'] })`.

- **Edge case (null/undefined result):** Pass `null` as result. Verify `ToolResultBlock.content` is `'null'` (JSON.stringify behavior).

**trimOldToolResults tests:**

- **Image tool result trimming:** Build a message history with >8 messages, where an older user message contains a `tool_result` block with array content including an image block. Call `trimOldToolResults`. Verify the image tool result is replaced with the placeholder string.

- **Recent image tool results preserved:** Same setup but place the image tool result within the last 8 messages. Verify it is NOT trimmed.

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && bun test src/agent/agent.test.ts
```

Expected: All tests pass.

**Commit:** `test(agent): add tests for formatNativeToolResult and image context trimming`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
