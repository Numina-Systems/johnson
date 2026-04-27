# Image Viewing Tool Implementation Plan — Phase 1: Types and Contracts

**Goal:** Define the TypeScript types that underpin the image viewing tool and its integration with the agent loop.

**Architecture:** Add `ImageSourceBlock` to the content block union in `src/model/types.ts`, and define an `ImageResult` return type used by the image tool handler. These types bridge the gap between the fetch-and-encode logic in the tool and the multi-content `ToolResultBlock` formatting in the agent loop.

**Tech Stack:** TypeScript (strict mode, Bun runtime)

**Scope:** 3 phases from original design (phase 1 of 3)

**Codebase verified:** 2025-04-27

**Prerequisite:** #3 Multi-Tool Architecture must be merged first. This plan assumes:
- `ToolResultBlock.content` is already widened to `string | Array<ContentBlock>`
- `ToolRegistry` supports `mode: 'sandbox' | 'native' | 'both'` per entry
- `registry.register()` accepts an optional `mode` parameter (default `'sandbox'`)
- `registry.generateToolDefinitions()` returns definitions for native/both-mode tools
- Agent loop in `src/agent/agent.ts` has a native dispatch branch for non-`execute_code` tools

---

## Acceptance Criteria Coverage

This phase implements types only. No behavioral ACs are tested here.

### GH09.AC3: Returns base64-encoded image with correct media type
- **GH09.AC3.1:** `ImageResult` type defines the contract: `type`, `text`, and `image` fields

### GH09.AC4: Agent loop formats image result as multi-content ToolResultBlock
- **GH09.AC4.1:** `ImageSourceBlock` type exists in the `ContentBlock` union, enabling image blocks in tool results

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add ImageSourceBlock to content block types

**Verifies:** GH09.AC4.1

**Files:**
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/model/types.ts`

**Implementation:**

Add an `ImageSourceBlock` type to `src/model/types.ts` and include it in the `ContentBlock` union. This type represents base64-encoded image data in the Anthropic content block format.

After #3 is merged, `src/model/types.ts` will already have the widened `ToolResultBlock.content: string | Array<ContentBlock>`. This task adds the image-specific block type that enables image data within those arrays.

Add this type definition after the existing `ImageBlock` type (which handles `image_url` for user-uploaded images):

```typescript
export type ImageSourceBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
```

Then update the `ContentBlock` union to include it:

```typescript
export type ContentBlock = TextBlock | ImageBlock | ImageSourceBlock | ToolUseBlock | ToolResultBlock;
```

Note: `ImageBlock` (existing, `type: 'image_url'`) is for user-sent images via Discord/TUI. `ImageSourceBlock` (new, `type: 'image'`) is for base64 images returned in tool results, matching the Anthropic API's image content block format.

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors. The compiler validates the union is well-formed.

**Commit:** `feat(types): add ImageSourceBlock to ContentBlock union for image tool results`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Define ImageResult return type

**Verifies:** GH09.AC3.1

**Files:**
- Create: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/tools/image.ts` (partial — types only, implementation in Phase 2)

**Implementation:**

Create the `src/tools/` directory and the `src/tools/image.ts` file. For now, only export the `ImageResult` type that the tool handler will return. The type is also consumed by the agent loop's `formatNativeToolResult()` helper (Phase 3) to detect image results and format them as multi-content tool result blocks.

```typescript
// pattern: Functional Core

export type ImageResult = {
  readonly type: 'image_result';
  readonly text: string;
  readonly image: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
};
```

The `type: 'image_result'` discriminant enables runtime detection in the agent loop without importing the full tool module.

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors.

**Commit:** `feat(image): add ImageResult type contract for view_image tool`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
