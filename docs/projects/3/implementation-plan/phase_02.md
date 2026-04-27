# GH03: Multi-Tool Architecture — Phase 2: Widen ToolResultBlock Content Type

**Goal:** Widen `ToolResultBlock.content` from `string` to `string | Array<ContentBlock>` so native tools can return rich content (e.g., image content blocks) in tool results.

**Architecture:** Change the type in `src/model/types.ts`, then update all 4 model providers and the 2 context-handling modules that read `block.content` to handle the new union type. For OpenAI-compat and OpenRouter providers, array content is serialized to JSON string since those APIs only accept string tool results. The Anthropic provider already passes content through to the SDK, which natively supports array content.

**Tech Stack:** TypeScript, Bun

**Scope:** 4 phases from original design (phases 1-4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH03.AC7: ToolResultBlock content type
- **GH03.AC7.1 Success:** `ToolResultBlock.content` supports `string | Array<ContentBlock>`

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Widen ToolResultBlock.content type

**Files:**
- Modify: `src/model/types.ts:15-20`

**Implementation:**

Change the `ToolResultBlock` type. The `content` field changes from `string` to `string | Array<ContentBlock>`.

Because `ContentBlock` is defined AFTER `ToolResultBlock` in the file (line 27), and `ContentBlock` includes `ToolResultBlock`, this creates a circular reference. TypeScript handles this fine for type aliases in the same file — forward references work. But to be safe, define a dedicated `ToolResultContent` type for the union members that can appear inside a tool result (text and image blocks only — not `ToolUseBlock` or `ToolResultBlock` themselves):

```typescript
export type ToolResultContentBlock = TextBlock | ImageBlock;

export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<ToolResultContentBlock>;
  is_error?: boolean;
};
```

This avoids the circular reference entirely and is more precise — a tool result's array content should only contain text and image blocks, never nested tool_use or tool_result blocks.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Type errors in files that assume `content` is always `string`. These will be fixed in subsequent tasks.

**Commit:** Do not commit yet — complete the rest of this subcomponent first.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add content serialization helper

**Files:**
- Modify: `src/model/types.ts` (add at end of file)

**Implementation:**

Add a pure helper function that serializes `ToolResultBlock.content` to a plain string. This is used by model providers that only accept string content for tool results (OpenRouter, OpenAI-compat, Ollama).

```typescript
/**
 * Serialize ToolResultBlock content to a plain string.
 * If content is already a string, return as-is.
 * If content is an array of content blocks, extract text parts and join them.
 * Image blocks are represented as '[image]' placeholders.
 */
export function toolResultContentToString(
  content: string | Array<ToolResultContentBlock>,
): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image_url') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Same type errors as before (providers not yet updated). The helper itself should compile.

**Commit:** Do not commit yet.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update model providers to handle widened content type

**Files:**
- Modify: `src/model/openrouter.ts:80-85` and `src/model/openrouter.ts:96-100`
- Modify: `src/model/openai-compat.ts:114-119` and `src/model/openai-compat.ts:131-134`
- Modify: `src/model/ollama.ts:103-107`
- Modify: `src/model/anthropic.ts` (no changes needed — passes through to SDK)

**Implementation:**

Import `toolResultContentToString` from `../model/types.ts` in the three providers that serialize tool results to strings.

**openrouter.ts** — Two locations where `block.content` is used as tool result content:

Line 83 (inside `hasImages` branch):
```typescript
} else if (block.type === 'tool_result') {
  result.push({
    role: 'tool',
    toolCallId: block.tool_use_id,
    content: toolResultContentToString(block.content),
  });
}
```

Line 99 (inside the else branch):
```typescript
} else if (block.type === 'tool_result') {
  result.push({
    role: 'tool',
    toolCallId: block.tool_use_id,
    content: toolResultContentToString(block.content),
  });
}
```

**openai-compat.ts** — Two locations:

Line 117 (inside `hasImages` branch):
```typescript
} else if (block.type === 'tool_result') {
  toolResults.push({
    role: 'tool',
    tool_call_id: block.tool_use_id,
    content: toolResultContentToString(block.content),
  });
}
```

Line 134 (inside the else branch):
```typescript
} else if (block.type === 'tool_result') {
  result.push({
    role: 'tool',
    tool_call_id: block.tool_use_id,
    content: toolResultContentToString(block.content),
  });
}
```

**ollama.ts** — One location:

Line 105:
```typescript
} else if (block.type === 'tool_result') {
  result.push({
    role: 'tool',
    content: toolResultContentToString(block.content),
  });
}
```

**anthropic.ts** — No changes needed. The Anthropic provider passes `m.content` directly to the SDK via a type cast (line 50: `content: m.content as Anthropic.MessageCreateParams['messages'][number]['content']`). The Anthropic SDK natively supports array content in tool results, so widening our type aligns with their API.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Remaining errors only in `src/agent/context.ts` (fixed in Task 4).

**Commit:** Do not commit yet.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update context.ts and compaction.ts for widened type

**Files:**
- Modify: `src/agent/context.ts:161-175` (trimOldToolResults)
- Modify: `src/agent/compaction.ts:30` (formatConversation)

**Implementation:**

**context.ts — `trimOldToolResults()`:**

The function at line 163 does `typeof content !== 'string'` and skips if not a string. After widening, `content` can be an array. The existing skip logic is actually fine for the trimming purpose — if content is already an array (rich content), we don't want to trim it to a placeholder. But we should still handle it for consistency.

Update the block starting at line 161:

```typescript
if (block.type !== 'tool_result') continue;

const content = block.content;

// Array content (rich results like images) — skip trimming
if (typeof content !== 'string') continue;

// Skip if already trimmed or small
if (content.startsWith('[tool result:') || content.length < 200) continue;
```

This is actually the same logic that exists today — `typeof content !== 'string'` already guards correctly. The only change is that TypeScript now knows `content` can legitimately be an array, so the guard no longer looks like dead code. No functional change needed, but add a clarifying comment.

**compaction.ts — `formatConversation()`:**

Line 30 does `block.content?.toString().slice(0, 200)`. After widening, if `content` is an array, `toString()` would produce `[object Object],[object Object]` which is useless.

Import `toolResultContentToString` and update line 30:

```typescript
if (block.type === 'tool_result') return `[tool_result: ${toolResultContentToString(block.content).slice(0, 200)}]`;
```

Add the import at the top of `compaction.ts`:

```typescript
import { toolResultContentToString } from '../model/types.ts';
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Zero type errors across the entire project.

Run: `bun test`
Expected: All existing tests pass.

**Commit:**
```bash
git add src/model/types.ts src/model/openrouter.ts src/model/openai-compat.ts src/model/ollama.ts src/agent/context.ts src/agent/compaction.ts
git commit -m "feat(types): widen ToolResultBlock.content to support array content blocks"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Write tests for toolResultContentToString helper

**Verifies:** GH03.AC7.1

**Files:**
- Create: `src/model/types.test.ts`

**Testing:**
Tests must verify:
- **GH03.AC7.1 (string path):** Pass a plain string — returns same string.
- **GH03.AC7.1 (array with text):** Pass an array with text blocks — returns joined text.
- **GH03.AC7.1 (array with image):** Pass an array with an image block — returns `'[image]'` placeholder.
- **GH03.AC7.1 (mixed array):** Pass an array with text + image blocks — returns text with `'[image]'` placeholder joined by newlines.
- **GH03.AC7.1 (empty array):** Pass empty array — returns empty string.

**Verification:**
Run: `bun test src/model/types.test.ts`
Expected: All tests pass.

**Commit:**
```bash
git add src/model/types.test.ts
git commit -m "test(types): add toolResultContentToString tests"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Verify type-check passes project-wide

**Implementation:**

Run full type check and full test suite to confirm nothing is broken.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Zero errors.

Run: `bun test`
Expected: All tests pass.

**Commit:** No commit needed — verification only.
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->
