# Image Viewing Tool Implementation Plan — Phase 2: Tool Implementation and Registration

**Goal:** Implement the `view_image` tool handler and register it as a native tool in the agent's tool registry.

**Architecture:** The `viewImage` handler fetches an image URL, validates content-type and size, encodes to base64, and returns an `ImageResult`. Registration uses `mode: 'native'` so the tool appears as a direct `tool_use` definition to the model (not routed through the Deno sandbox). No sandbox stubs are generated for this tool.

**Tech Stack:** TypeScript, Bun runtime, native `fetch` API

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2025-04-27

**Prerequisite:** Phase 1 (types) must be complete. #3 Multi-Tool Architecture must be merged (registry `mode` support).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH09.AC1: view_image fetches URL, validates content-type starts with image/
- **GH09.AC1.1 Success:** Fetch a valid image URL, verify content-type validated
- **GH09.AC1.2 Failure:** Fetch a URL returning non-image content-type, verify error thrown

### GH09.AC2: Rejects images > 10MB (checks both content-length header and actual body size)
- **GH09.AC2.1 Failure (header):** content-length header exceeds 10MB, verify error before reading body
- **GH09.AC2.2 Failure (body):** Actual body exceeds 10MB (no content-length or lying header), verify error after read

### GH09.AC3: Returns base64-encoded image with correct media type
- **GH09.AC3.1 Success:** PNG image fetched, verify base64 data and media_type = `image/png`

### GH09.AC6: 30s fetch timeout
- **GH09.AC6.1:** AbortSignal.timeout(30_000) is passed to fetch

### GH09.AC7: Registered as mode: 'native' only — no sandbox stubs
- **GH09.AC7.1:** Tool registered with `mode: 'native'` in the registry

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Implement viewImage handler

**Verifies:** GH09.AC1.1, GH09.AC1.2, GH09.AC2.1, GH09.AC2.2, GH09.AC3.1, GH09.AC6.1

**Files:**
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/tools/image.ts` (add implementation to existing types-only file from Phase 1)

**Implementation:**

Add the `viewImage` async function to `src/tools/image.ts` below the existing `ImageResult` type. This function:

1. Calls `fetch(url)` with `AbortSignal.timeout(30_000)` for a 30-second timeout.
2. Checks `response.ok` — throws on non-2xx status.
3. Validates `content-type` header starts with `image/` — throws if not.
4. Checks `content-length` header if present — throws if > 10MB (10 * 1024 * 1024 bytes).
5. Reads the full body as `ArrayBuffer`.
6. Checks actual `buffer.byteLength` — throws if > 10MB (handles missing/lying content-length).
7. Converts to base64 via `Buffer.from(buffer).toString('base64')`.
8. Extracts media type from content-type (strips charset/params).
9. Returns `ImageResult` with `type: 'image_result'`, text description, and image payload.

The 10MB limit constant should be a module-level `const MAX_IMAGE_BYTES = 10 * 1024 * 1024`.

```typescript
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function viewImage(url: string): Promise<ImageResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Not an image: content-type is ${contentType}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes (max 10MB)`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${buffer.byteLength} bytes (max 10MB)`);
  }

  const base64 = Buffer.from(buffer).toString('base64');
  const mediaType = contentType.split(';')[0]!.trim();

  return {
    type: 'image_result',
    text: `Image from ${url}`,
    image: { type: 'base64', media_type: mediaType, data: base64 },
  };
}
```

Note: The function takes a plain `string` URL rather than a `Record<string, unknown>` params object. Parameter extraction from the tool input is handled in the registration wrapper (Task 2), keeping `viewImage` pure and easy to test.

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors.

**Commit:** `feat(image): implement viewImage handler with validation and base64 encoding`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register view_image as a native tool

**Verifies:** GH09.AC7.1

**Files:**
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/tools/image.ts` (add `registerImageTools` export)
- Modify: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/agent/tools.ts` (call `registerImageTools`)

**Implementation:**

Add a `registerImageTools(registry: ToolRegistry)` function to `src/tools/image.ts` that registers `view_image` with `mode: 'native'`. This follows the pattern established by #3 where tools declare their dispatch mode at registration.

In `src/tools/image.ts`, add below `viewImage`:

```typescript
import type { ToolRegistry } from '../runtime/tool-registry.ts';

export function registerImageTools(registry: ToolRegistry): void {
  registry.register(
    'view_image',
    {
      name: 'view_image',
      description:
        'Fetch and view an image from a URL. Returns the image as a base64-encoded content block that you can see and analyze. Supports JPEG, PNG, GIF, and WebP. Max size: 10MB.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Image URL to fetch and view',
          },
        },
        required: ['url'],
      },
    },
    async (params) => {
      const url = params['url'];
      if (typeof url !== 'string') {
        throw new Error('missing required param: url');
      }
      return viewImage(url);
    },
    'native',
  );
}
```

The `'native'` mode means:
- The tool appears in `registry.generateToolDefinitions()` (sent to the model as a tool_use definition alongside `execute_code`)
- The tool does NOT appear in `registry.generateTypeScriptStubs()` (no sandbox stub — the Deno sandbox cannot call this tool)
- The tool DOES appear in `registry.generateToolDocumentation()` (documented in the system prompt so the model knows it exists)

In `src/agent/tools.ts`, import and call `registerImageTools` at the end of `createAgentTools()`, just before `return registry`:

```typescript
import { registerImageTools } from '../tools/image.ts';

// ... existing registrations ...

registerImageTools(registry);

return registry;
```

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && npx tsc --noEmit
```

Expected: No type errors. The `registry.register` call with 4 arguments (including `mode`) compiles because #3 updated the signature.

**Commit:** `feat(image): register view_image as native tool in agent tool registry`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for viewImage handler

**Verifies:** GH09.AC1.1, GH09.AC1.2, GH09.AC2.1, GH09.AC2.2, GH09.AC3.1, GH09.AC6.1, GH09.AC7.1

**Files:**
- Create: `/Users/scarndp/dev/johnson/.worktrees/GH09/src/tools/image.test.ts`

**Testing:**

This project uses `bun test` (Bun's built-in test runner). No test files exist yet, so this will be the first.

Tests must verify each AC listed above by mocking `fetch` to return controlled responses. Use `mock.module` or direct global `fetch` replacement.

The test file should cover these scenarios:

- **GH09.AC1.1 (valid image):** Mock fetch returning a 200 with `content-type: image/png` and a small PNG byte payload. Verify `viewImage` returns an `ImageResult` with `type: 'image_result'`, correct `media_type: 'image/png'`, base64-encoded data matching the input bytes, and text containing the URL.

- **GH09.AC1.2 (non-image content-type):** Mock fetch returning `content-type: text/html`. Verify `viewImage` throws with message containing "Not an image".

- **GH09.AC2.1 (content-length too large):** Mock fetch returning `content-length: 20000000` (>10MB) with `content-type: image/png`. Verify `viewImage` throws with message containing "too large". The body should NOT be read (error thrown before `arrayBuffer()` call).

- **GH09.AC2.2 (body too large, no content-length):** Mock fetch returning no `content-length` header but an `arrayBuffer()` that yields >10MB. Verify `viewImage` throws with message containing "too large".

- **GH09.AC3.1 (base64 encoding correctness):** Mock fetch returning known bytes. Verify the `data` field in the result matches `Buffer.from(knownBytes).toString('base64')`.

- **GH09.AC6.1 (30s timeout):** Verify that fetch is called with a signal. This can be checked by inspecting the arguments passed to the mock fetch, confirming `signal` is an `AbortSignal`.

- **GH09.AC1.2 (HTTP error):** Mock fetch returning status 404. Verify `viewImage` throws with message containing "HTTP 404".

- **GH09.AC7.1 (native registration):** Call `registerImageTools` with a mock registry, verify `register` was called with name `'view_image'` and mode `'native'`.

Create a minimal PNG for testing (the smallest valid PNG is 68 bytes — the 1x1 transparent pixel):

```typescript
// Smallest valid 1x1 transparent PNG
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // RGBA, etc.
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02, // compressed data
  0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00, // ...
  0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, // IEND chunk
  0x60, 0x82,
]);
```

**Verification:**

```bash
cd /Users/scarndp/dev/johnson/.worktrees/GH09 && bun test src/tools/image.test.ts
```

Expected: All tests pass.

**Commit:** `test(image): add tests for viewImage handler and registration`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
