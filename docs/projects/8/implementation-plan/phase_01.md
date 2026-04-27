# GH08: Summarization Tool — Implementation Plan

**Goal:** Add a `summarize` tool that sends text to a sub-agent LLM and returns a concise summary, with configurable length and optional focus instructions.

**Architecture:** New file `src/tools/summarize.ts` exports a registration function that adds the `summarize` tool to the ToolRegistry. The tool handler calls `deps.subAgent.complete()` with a constructed prompt. Shared parameter helpers are extracted from `src/agent/tools.ts` into `src/tools/helpers.ts` so all tool files can reuse them. Registration is wired from `createAgentTools()` in `src/agent/tools.ts`.

**Tech Stack:** TypeScript (Bun runtime), bun:test for testing

**Scope:** 2 phases from design

**Prerequisites:** This feature depends on two prior features that MUST be implemented before execution begins:
- **#3 Multi-Tool Architecture** — `ToolRegistry.register()` must accept a `mode` parameter (`'sandbox' | 'native' | 'both'`), and `generateToolDefinitions()` must exist on the registry. The agent loop must dispatch native tool calls directly through the registry.
- **#4 Sub-Agent LLM** — `SubAgentLLM` type must exist at `src/model/sub-agent.ts` with `complete(prompt: string, system?: string): Promise<string>`. `AgentDependencies` must include `subAgent?: SubAgentLLM`.

**Verify prerequisites at execution time:** Before starting Phase 1, confirm:
1. `src/model/sub-agent.ts` exists and exports `SubAgentLLM`
2. `src/agent/types.ts` has `subAgent?: SubAgentLLM` on `AgentDependencies`
3. `src/runtime/tool-registry.ts` `register()` accepts a `mode` parameter
4. `src/runtime/tool-registry.ts` exports `generateToolDefinitions()` on the registry

If any are missing, STOP and report — the dependency features have not been merged yet.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements:

### GH08.AC1: Sub-agent invocation
- **GH08.AC1.1:** `summarize` sends text to sub-agent with appropriate system prompt

### GH08.AC2: Input truncation
- **GH08.AC2.1:** Input truncated at 100k chars

### GH08.AC3: Length guidance mapping
- **GH08.AC3.1:** `max_length` maps to correct length guidance

### GH08.AC4: Optional instructions
- **GH08.AC4.1:** Optional `instructions` appended to prompt as focus guidance

### GH08.AC5: Missing sub-agent error
- **GH08.AC5.1:** Missing sub-agent produces clear error message

### GH08.AC6: Registration mode
- **GH08.AC6.1:** Registered as `mode: 'both'` — native tool_use + sandbox stubs

---

## Phase 1: Tool Implementation and Registration

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Extract shared parameter helpers to `src/tools/helpers.ts`

**Verifies:** None (infrastructure refactor enabling future tool files)

**Files:**
- Create: `src/tools/helpers.ts`
- Modify: `src/agent/tools.ts` (lines 11-20, import section at line 5)

**Implementation:**

Create `src/tools/helpers.ts` with the `str` and `optStr` helper functions currently defined in `src/agent/tools.ts` (lines 11-19). These are parameter extraction utilities needed by every tool handler.

```typescript
// src/tools/helpers.ts
// pattern: Functional Core — shared parameter extraction helpers for tool handlers

/**
 * Extract a required string parameter from tool input.
 * Throws if the parameter is missing or not a string.
 */
export function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

/**
 * Extract an optional string parameter from tool input.
 * Returns the fallback value if the parameter is missing or not a string.
 */
export function optStr(input: Record<string, unknown>, key: string, fallback: string = ''): string {
  const val = input[key];
  return typeof val === 'string' ? val : fallback;
}
```

Then update `src/agent/tools.ts`:
- Remove the local `str` and `optStr` function definitions (lines 11-19)
- Add import at the top: `import { str, optStr } from '../tools/helpers.ts';`
- Keep `hashCode` in `src/agent/tools.ts` since it's only used there

**Verification:**

Run: `bun run build`
Expected: Build succeeds with no errors. Existing tool registrations still use `str` and `optStr` unchanged.

**Commit:** `refactor: extract shared tool parameter helpers to src/tools/helpers.ts`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/tools/summarize.ts` with tool definition and handler

**Verifies:** GH08.AC1.1, GH08.AC2.1, GH08.AC3.1, GH08.AC4.1, GH08.AC5.1, GH08.AC6.1

**Files:**
- Create: `src/tools/summarize.ts`

**Implementation:**

Create the summarize tool module. The function accepts a `ToolRegistry` and `AgentDependencies`, and registers the `summarize` tool with `mode: 'both'`.

The handler:
1. Guards on `deps.subAgent` being defined — throws a clear error if not configured (AC5.1)
2. Extracts `text` (required), truncates to 100,000 characters (AC2.1)
3. Extracts optional `instructions` and `max_length` (default `'medium'`)
4. Maps `max_length` to a length guidance string (AC3.1):
   - `'short'` -> `'Respond in 2-3 sentences.'`
   - `'medium'` -> `'Respond in 1-2 paragraphs.'`
   - `'long'` -> `'Respond in up to 4 paragraphs.'`
5. Builds the prompt: summarization instruction + length guidance + optional focus instructions (AC4.1) + the text to summarize
6. Calls `deps.subAgent.complete(prompt, system)` with a system prompt that instructs precise, fact-preserving summarization (AC1.1)
7. Returns `{ summary: result }`

```typescript
// src/tools/summarize.ts
// pattern: Functional Core — summarize tool registration

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { str, optStr } from './helpers.ts';

const LENGTH_GUIDANCE: Record<string, string> = {
  short: 'Respond in 2-3 sentences.',
  medium: 'Respond in 1-2 paragraphs.',
  long: 'Respond in up to 4 paragraphs.',
};

const SUMMARIZE_SYSTEM = 'You are a precise summarization assistant. Preserve key facts, names, and numbers. Do not add information not present in the source text.';

const MAX_INPUT_CHARS = 100_000;

export function registerSummarizeTools(registry: ToolRegistry, deps: Readonly<AgentDependencies>): void {
  registry.register(
    'summarize',
    {
      name: 'summarize',
      description:
        `Summarize text using a sub-agent LLM. Returns a concise summary preserving key facts.

Use for long documents, articles, or any content that needs condensing. Optionally provide focus instructions to guide what the summary emphasizes.`,
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Content to summarize (truncated at 100k chars)' },
          instructions: { type: 'string', description: 'Optional focus guidance (e.g., "focus on technical claims")' },
          max_length: {
            type: 'string',
            enum: ['short', 'medium', 'long'],
            description: 'Summary length: "short" (2-3 sentences), "medium" (1-2 paragraphs), "long" (up to 4 paragraphs). Default: "medium".',
          },
        },
        required: ['text'],
      },
    },
    async (params) => {
      if (!deps.subAgent) {
        throw new Error('Sub-agent LLM not configured. Add [sub_model] to config.toml.');
      }

      const text = str(params, 'text').slice(0, MAX_INPUT_CHARS);
      const instructions = optStr(params, 'instructions');
      const maxLength = optStr(params, 'max_length', 'medium');

      let prompt = `Summarize the following text. ${LENGTH_GUIDANCE[maxLength] ?? LENGTH_GUIDANCE.medium}`;
      if (instructions) {
        prompt += `\n\nFocus: ${instructions}`;
      }
      prompt += `\n\n---\n\n${text}`;

      const result = await deps.subAgent.complete(prompt, SUMMARIZE_SYSTEM);
      return { summary: result };
    },
    'both',
  );
}
```

**Note on `register()` call:** The fourth argument `'both'` is the `mode` parameter added by #3 Multi-Tool Architecture. If at execution time `register()` does not accept a fourth argument, check the #3 implementation — the mode parameter may be passed differently (e.g., as part of the definition object). Adapt accordingly.

**Verification:**

Run: `bun run build`
Expected: Build succeeds. The file compiles without type errors.

**Commit:** `feat: add summarize tool (GH08)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire registration into `createAgentTools()`

**Verifies:** GH08.AC6.1

**Files:**
- Modify: `src/agent/tools.ts` (add import at top, add registration call before `return registry`)

**Implementation:**

Add the import at the top of `src/agent/tools.ts`, alongside the existing imports:

```typescript
import { registerSummarizeTools } from '../tools/summarize.ts';
```

Add the registration call just before the `return registry;` line (currently line 327):

```typescript
  // ── summarize (via sub-agent) ──────────────────────────────────────────
  registerSummarizeTools(registry, deps);

  return registry;
```

This follows the existing pattern where `createAgentTools()` is the single wiring point for all tools.

**Verification:**

Run: `bun run build`
Expected: Build succeeds. The summarize tool is now registered when the agent initializes.

**Commit:** `feat: wire summarize tool registration (GH08)`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
