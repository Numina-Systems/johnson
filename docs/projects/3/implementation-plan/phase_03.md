# GH03: Multi-Tool Architecture — Phase 3: Agent Loop Native Dispatch

**Goal:** Update the agent loop to build a combined tools list (execute_code + native tools from registry) and dispatch native tool calls directly through the registry instead of through the Deno sandbox.

**Architecture:** The agent loop currently hardcodes `tools: [EXECUTE_CODE_TOOL]` when calling the model. After this phase, it builds the list as `[EXECUTE_CODE_TOOL, ...registry.generateToolDefinitions()]`. When the model returns a `tool_use` block, the dispatch logic checks the tool name: `execute_code` goes through the existing Deno sandbox path (unchanged), any other name goes directly to `registry.execute()`. A `formatNativeToolResult()` helper converts the registry handler's return value into a `ToolResultBlock`.

**Tech Stack:** TypeScript, Bun

**Scope:** 4 phases from original design (phases 1-4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH03.AC5: Agent loop dispatches native tools directly
- **GH03.AC5.1 Success:** Agent loop dispatches native tools directly through registry

### GH03.AC6: Agent loop still dispatches execute_code through Deno sandbox
- **GH03.AC6.1 Success:** Agent loop still dispatches `execute_code` through Deno sandbox

### GH03.AC8: Existing tools unaffected
- **GH03.AC8.1 Success:** Existing tools unaffected — all 8 remain sandbox-only

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add formatNativeToolResult helper

**Files:**
- Modify: `src/agent/agent.ts` (add helper function before `createAgent`)

**Implementation:**

Add a helper function that converts the return value of a native tool handler into a `ToolResultBlock`. This handles three cases:

1. **String result** — use directly as content.
2. **Object with `type: 'image_result'`** — format as an array of content blocks (text + image). This is the convention for tools like `view_image` (GH09) that return image data.
3. **Any other object** — JSON.stringify it.

Add the following imports at the top of the file (some may already be imported):

```typescript
import type { ToolResultContentBlock } from '../model/types.ts';
```

Add the helper before `createAgent()`:

```typescript
function formatNativeToolResult(
  toolUseId: string,
  result: unknown,
): ToolResultBlock {
  // String results pass through directly
  if (typeof result === 'string') {
    return { type: 'tool_result', tool_use_id: toolUseId, content: result };
  }

  // Image results get formatted as array content blocks
  if (
    result !== null &&
    typeof result === 'object' &&
    'type' in result &&
    (result as Record<string, unknown>).type === 'image_result'
  ) {
    const r = result as Record<string, unknown>;
    const blocks: Array<ToolResultContentBlock> = [];

    if (typeof r.text === 'string') {
      blocks.push({ type: 'text', text: r.text });
    }

    if (r.image && typeof r.image === 'object') {
      const img = r.image as Record<string, unknown>;
      if (typeof img.data === 'string' && typeof img.media_type === 'string') {
        const dataUri = `data:${img.media_type};base64,${img.data}`;
        blocks.push({ type: 'image_url', image_url: { url: dataUri } });
      }
    }

    if (blocks.length > 0) {
      return { type: 'tool_result', tool_use_id: toolUseId, content: blocks };
    }
  }

  // Default: JSON stringify
  const serialized = typeof result === 'undefined' ? '(no output)' : JSON.stringify(result);
  return { type: 'tool_result', tool_use_id: toolUseId, content: serialized };
}
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Compiles. The helper is not called yet.

**Commit:** Do not commit yet — complete Task 2 first.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Build combined tools list and add native dispatch branch

**Files:**
- Modify: `src/agent/agent.ts:148-232` (tool loop section)

**Implementation:**

Two changes to the agent loop:

**Change 1: Build combined tools list**

At line 154, the model call currently uses `tools: [EXECUTE_CODE_TOOL]`. Change this to include native tool definitions from the registry:

```typescript
const nativeTools = registry.generateToolDefinitions();
```

Add this line after the registry is created (around line 86-90). Then update the model call at line 154:

```typescript
response = await deps.model.complete({
  system: systemPrompt,
  messages: history,
  tools: [EXECUTE_CODE_TOOL, ...nativeTools],
  model: deps.config.model,
  max_tokens: deps.config.maxTokens,
  temperature: deps.config.temperature,
  timeout: deps.config.modelTimeout,
});
```

**Change 2: Split dispatch on tool name**

Currently, all tool_use blocks are assumed to be `execute_code` and dispatched through the Deno sandbox. After this change, the dispatch checks the tool name first.

Replace the `toolUseBlocks.map(...)` block (lines 201-222) with logic that handles both paths:

```typescript
const toolResults: Array<ToolResultBlock> = await Promise.all(
  toolUseBlocks.map(async (block): Promise<ToolResultBlock> => {
    try {
      if (block.name === 'execute_code') {
        // Existing sandbox dispatch path — unchanged
        const code = (block.input as Record<string, unknown>)['code'];
        if (typeof code !== 'string') {
          return { type: 'tool_result', tool_use_id: block.id, content: 'Error: missing code parameter', is_error: true };
        }

        const onToolCall = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
          return registry.execute(name, params);
        };

        const result = await deps.runtime.execute(code, undefined, onToolCall);
        const output = result.success
          ? result.output || '(no output)'
          : `Error: ${result.error ?? 'unknown error'}\n${result.output}`;
        return { type: 'tool_result', tool_use_id: block.id, content: output, is_error: !result.success };
      } else {
        // Native tool dispatch — call registry directly
        const result = await registry.execute(block.name, block.input);
        return formatNativeToolResult(block.id, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: 'tool_result', tool_use_id: block.id, content: `Tool error: ${message}`, is_error: true };
    }
  }),
);
```

The key structural change: the `execute_code` path is now inside an `if (block.name === 'execute_code')` branch. The `else` branch dispatches native tools directly through the registry. The catch block at the end handles errors from both paths identically.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Zero type errors.

**Commit:**
```bash
git add src/agent/agent.ts
git commit -m "feat(agent): add native tool dispatch alongside execute_code sandbox path"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update system prompt tool documentation for native tools

**Files:**
- Modify: `src/agent/context.ts:55-57` (tool docs section of buildSystemPrompt)

**Implementation:**

Currently, the system prompt says tools are available "only inside TypeScript code you run via `execute_code`". Once native tools exist, this framing is incomplete. Native tools are called directly by the model — they don't go through `execute_code`.

The `generateToolDocumentation()` method in the registry already documents all tools. However, the framing text in `buildSystemPrompt()` (lines 55-57 in `context.ts`) wraps all tool docs under the "tools namespace" heading, which implies they're all sandbox-only.

The solution: `generateToolDocumentation()` should indicate which tools are native vs sandbox. Update `src/runtime/tool-registry.ts` `generateToolDocumentation()` to annotate native tools differently:

In `generateToolDocumentation()`, after the line `sections.push(`### \`tools.${name}\``);`, check the entry's mode. For native/both-mode tools, use a different heading:

```typescript
function generateToolDocumentation(): string {
  const sections: string[] = ["## Available Tools", ""];

  for (const [name, entry] of entries) {
    const def = entry.definition;

    if (entry.mode === 'native' || entry.mode === 'both') {
      sections.push(`### \`${name}\` *(direct tool call)*`);
      sections.push("");
      if (entry.mode === 'both') {
        sections.push(`> Available as both a direct tool call and via \`tools.${name}()\` in execute_code.`);
      } else {
        sections.push(`> Call this tool directly — do NOT use execute_code for this tool.`);
      }
      sections.push("");
    } else {
      sections.push(`### \`tools.${name}\``);
      sections.push("");
    }

    sections.push(def.description);
    sections.push("");

    const schema = def.input_schema as JsonSchemaObject;
    const properties = schema.properties;
    if (properties && Object.keys(properties).length > 0) {
      const requiredSet = new Set<string>(schema.required ?? []);
      sections.push("**Parameters:**");
      sections.push("");

      for (const [paramName, prop] of Object.entries(properties)) {
        const required = requiredSet.has(paramName) ? " *(required)*" : " *(optional)*";
        const tsType = jsonSchemaTypeToTs(prop);
        const desc = prop.description ? ` — ${prop.description}` : "";
        sections.push(`- \`${paramName}\`: \`${tsType}\`${required}${desc}`);
      }
      sections.push("");
    }
  }

  return sections.join("\n");
}
```

Also update the framing text in `buildSystemPrompt()` in `src/agent/context.ts`. Change lines 55-56 from:

```typescript
sections.push('\n\n## `tools` Namespace Reference\n\nThe following methods are available on the `tools` object **only inside TypeScript code you run via `execute_code`.** They are NOT callable as top-level functions. To use any of these, emit an `execute_code` tool call with TypeScript that does `await tools.<method>({...})`.\n');
```

to:

```typescript
sections.push('\n\n## Tool Reference\n\nTools marked with `tools.<name>` are available **only inside TypeScript code you run via `execute_code`.** Call them as `await tools.<method>({...})`. Tools marked *(direct tool call)* are called directly — do NOT use execute_code for those.\n');
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Zero type errors.

Run: `bun test`
Expected: All tests pass. Existing registry tests that check `generateToolDocumentation()` output may need their expected strings updated if they check for `tools.<name>` prefix — review and adjust if needed.

**Commit:**
```bash
git add src/runtime/tool-registry.ts src/agent/context.ts
git commit -m "feat(prompt): differentiate native vs sandbox tools in system prompt documentation"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
