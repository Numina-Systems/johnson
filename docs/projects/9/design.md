# #9 — Image Viewing Tool

**Issue:** https://github.com/Numina-Systems/johnson/issues/9
**Wave:** 2 (depends on: #3 multi-content ToolResultBlock)

## Design

### Why native-only

Image content blocks can't be tunnelled through the text-only sandbox IPC. The model needs to receive a base64 image block in the tool result, which requires the Anthropic content block format. This is the primary use case for native tool_use dispatch.

### Tool: `view_image`

Registered as `mode: 'native'` only. No sandbox stubs.

### Parameters

- `url` (string, required) — image URL to fetch

### Implementation

```typescript
async function viewImage(params): Promise<ImageResult> {
  const url = str(params, 'url');

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
  if (contentLength > 10 * 1024 * 1024) {
    throw new Error(`Image too large: ${contentLength} bytes (max 10MB)`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 10 * 1024 * 1024) {
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

### Agent Loop: Image Result Handling

In the native dispatch branch of `src/agent/agent.ts` (from #3), detect image results and format as multi-content `ToolResultBlock`:

```typescript
function formatNativeToolResult(toolUseId: string, result: unknown): ToolResultBlock {
  if (result && typeof result === 'object' && (result as any).type === 'image_result') {
    const img = result as ImageResult;
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        { type: 'text', text: img.text },
        { type: 'image', source: { type: 'base64', media_type: img.image.media_type, data: img.image.data } },
      ],
    };
  }

  // Default: stringify
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { type: 'tool_result', tool_use_id: toolUseId, content: text };
}
```

This uses the widened `ToolResultBlock.content: string | Array<ContentBlock>` from #3.

### Image Content Block Type

Add to `src/model/types.ts` if not already present:

```typescript
type ImageSourceBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
```

Add to the `ContentBlock` union.

### Registration

New file `src/tools/image.ts` exporting:

```typescript
function registerImageTools(registry: ToolRegistry): void
```

Called from `createAgentTools()` in `src/agent/tools.ts`. Mode: `'native'`.

## Files Touched

- `src/tools/image.ts` — new file, tool definition + handler
- `src/agent/tools.ts` — call `registerImageTools(registry)`
- `src/agent/agent.ts` — `formatNativeToolResult()` helper for image detection
- `src/model/types.ts` — `ImageSourceBlock` type if needed, add to `ContentBlock` union

## Acceptance Criteria

1. `view_image` fetches URL, validates content-type starts with `image/`
2. Rejects images > 10MB (checks both content-length header and actual body size)
3. Returns base64-encoded image with correct media type
4. Agent loop formats image result as multi-content `ToolResultBlock` (text + image block)
5. Non-image results stringify normally
6. 30s fetch timeout
7. Registered as `mode: 'native'` only — no sandbox stubs
8. Test: mock fetch returning PNG bytes → verify base64 encoding
9. Test: mock fetch returning non-image content-type → verify error
10. Test: `formatNativeToolResult` with image result → verify content block structure
