# Image Viewing Tool Implementation Plan — Phase 3: Agent Loop Integration

**Goal:** Wire the `view_image` tool's `ImageResult` return value into the agent loop so that image data is formatted as a multi-content `ToolResultBlock` (text + image block) that the model can see.

**Architecture:** GH03 Phase 3 already added a `formatNativeToolResult()` helper in `src/agent/agent.ts` that handles image results by detecting `type: 'image_result'` and formatting them using `ImageBlock` (`type: 'image_url'` with a data URI). This phase updates that existing helper to use the Anthropic-native `ImageSourceBlock` format (`type: 'image'` with `source.type: 'base64'`) instead of data URIs, which is more efficient and directly supported by the Anthropic API. It also updates `ToolResultContentBlock` in `src/model/types.ts` to include `ImageSourceBlock`. The context trimming logic in `context.ts` is updated to handle array-valued tool result content containing image blocks.

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

**IMPORTANT — alignment with GH03:** GH03 Phase 3 already created `formatNativeToolResult` in `src/agent/agent.ts`. That version handles image results by wrapping them as `ImageBlock` (`type: 'image_url'` with a `data:` URI). This phase must UPDATE that existing function, not create a second one.

Two changes are needed:

**Change 1: Update `ToolResultContentBlock` in `src/model/types.ts`** to include `ImageSourceBlock`:

GH03 Phase 2 defined:
```typescript
export type ToolResultContentBlock = TextBlock | ImageBlock;
```

Update it to:
```typescript
export type ToolResultContentBlock = TextBlock | ImageBlock | ImageSourceBlock;
```

This allows tool result content arrays to contain the Anthropic-native image format (`type: 'image'` with `source.type: 'base64'`), which is more efficient than data URIs.

**Change 2: Update the image branch in `formatNativeToolResult`** (in `src/agent/agent.ts`). GH03's version wraps images as `{ type: 'image_url', image_url: { url: dataUri } }`. Replace this with the Anthropic-native format:

Replace the image-result branch from:
```typescript
if (typeof img.data === 'string' && typeof img.media_type === 'string') {
  const dataUri = `data:${img.media_type};base64,${img.data}`;
  blocks.push({ type: 'image_url', image_url: { url: dataUri } });
}
```

To:
```typescript
if (typeof img.data === 'string' && typeof img.media_type === 'string') {
  blocks.push({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type, data: img.data },
  });
}
```

This produces `ImageSourceBlock` instead of `ImageBlock`, which the Anthropic API handles natively without the overhead of a base64 data URI wrapper. The `ToolResultContentBlock` union now includes `ImageSourceBlock`, so this is type-safe.

The native dispatch branch in the agent loop (also from GH03 Phase 3) already uses `formatNativeToolResult` — no changes needed there.

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
