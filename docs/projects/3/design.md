# #3 — Multi-Tool Architecture

**Issue:** https://github.com/Numina-Systems/johnson/issues/3
**Wave:** 1 (no hard dependencies, major registry change)

## Current State

Everything routes through a single `execute_code` tool. The model writes TypeScript, the sandbox executes it, and tool calls go through IPC (`tools.*` namespace).

## Key Insight: Keep execute_code as Primary

The sandbox dispatch model has real advantages over native tool_use for the core tools:

- **Batching:** `Promise.allSettled([tools.doc_get(...), tools.doc_search(...)])` in one sandbox call. Native tool_use = two separate API round trips.
- **Composition:** `doc_search → filter → doc_get each → format → output()` in one call. Native dispatch = multiple LLM round-trips with the model doing glue logic in text.
- **Token efficiency:** Native tool_use results are full messages in conversation context. Sandbox batching keeps intermediate results out of context.
- **Consistency:** Two paths to the same thing = the model has to decide which to use, and sometimes picks wrong.

**Do NOT add a parallel native dispatch path for the existing 8 tools** (doc_upsert, doc_get, doc_list, doc_search, run_skill, schedule_task, list_tasks, cancel_task). They stay sandbox-only.

## Design

### Where native tool_use wins

Native dispatch is justified only when:

1. **Result format requires it** — `view_image` needs to return an image content block the model can see. Can't tunnel that through text-only sandbox results.
2. **Sandbox routing adds no value** — `notify_discord` is fire-and-forget. `summarize` calls a sub-agent LLM and returns text. Neither benefits from batching or composition.

### Selective native tools

These tools get native `tool_use` definitions:
- `view_image` (#9) — image content blocks
- `notify_discord` (#6) — fire-and-forget webhook
- `summarize` (#8) — sub-agent call, no composition value

Everything else stays sandbox-only via `execute_code`.

### Registry Changes (`src/runtime/tool-registry.ts`)

Add a `mode` flag to tool registration:

```typescript
type ToolMode = 'sandbox' | 'native' | 'both';

type RegistryEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
  mode: ToolMode;
};
```

- `'sandbox'` — available in Deno sandbox via stubs only (existing tools)
- `'native'` — exposed as API-level tool_use definition only (image, notify, summarize)
- `'both'` — available in both paths (if needed in future)

New methods:
- `generateToolDefinitions(): ToolDefinition[]` — returns definitions for tools with mode `'native'` or `'both'`
- Existing `generateTypeScriptStubs()` — generates stubs for tools with mode `'sandbox'` or `'both'`
- Existing `generateToolDocumentation()` — documents ALL tools (all modes) for the system prompt

Update `register()` to accept mode (default `'sandbox'` for backward compat).

### Agent Loop Changes (`src/agent/agent.ts`)

Build tools list:
```typescript
const nativeTools = registry.generateToolDefinitions();
const tools = [EXECUTE_CODE_TOOL, ...nativeTools];
```

Tool dispatch splits on name:
```typescript
if (block.name === 'execute_code') {
  // existing Deno sandbox path — unchanged
} else {
  // native tool: dispatch directly through registry
  const result = await registry.execute(block.name, block.input);
  // format result for ToolResultBlock
}
```

### Tool Result Formatting

Native tool results need to be formatted into `ToolResultBlock`:

- **String results:** Use as-is for `content`
- **Object results:** `JSON.stringify(result)`
- **Image results:** Special case — when result has `type: 'image_result'`, format as multi-content-block (text + image block). This requires widening `ToolResultBlock.content`.

### Type Change (`src/model/types.ts`)

Widen `ToolResultBlock.content` from `string` to `string | Array<ContentBlock>`:

```typescript
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<ContentBlock>;
  is_error?: boolean;
};
```

This enables image content blocks in tool results. Model providers that serialize messages need to handle the array case.

### Backward Compatibility

- All existing tools unchanged — still `mode: 'sandbox'`, still work through `execute_code`
- `execute_code` tool definition unchanged
- Deno stubs still generated for sandbox-mode tools
- System prompt documents all tools regardless of mode
- New native tools are *also* documented in the system prompt so the model knows about them

## Files Touched

- `src/runtime/tool-registry.ts` — add `mode`, `generateToolDefinitions()`, update `register()` signature
- `src/agent/agent.ts` — build combined tools list, add native dispatch branch
- `src/model/types.ts` — widen `ToolResultBlock.content`
- `src/agent/tools.ts` — no changes (existing tools keep default `mode: 'sandbox'`)

## Acceptance Criteria

1. Registry supports `mode: 'sandbox' | 'native' | 'both'` per tool
2. `generateToolDefinitions()` returns only native/both-mode tools
3. `generateTypeScriptStubs()` generates stubs for only sandbox/both-mode tools
4. `generateToolDocumentation()` documents all tools regardless of mode
5. Agent loop dispatches native tools directly through registry
6. Agent loop still dispatches `execute_code` through Deno sandbox
7. `ToolResultBlock.content` supports `string | Array<ContentBlock>`
8. Existing tools unaffected — all 8 remain sandbox-only
9. Test: register native tool → verify it appears in `generateToolDefinitions()` but not in stubs
10. Test: mock model returns native tool_use → verify registry.execute called directly
11. Test: mock model returns `execute_code` → verify Deno sandbox path unchanged
