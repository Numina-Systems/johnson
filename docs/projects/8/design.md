# #8 — Summarization Tool (via Sub-Agent)

**Issue:** https://github.com/Numina-Systems/johnson/issues/8
**Wave:** 2 (depends on: #3 registry mode, #4 sub-agent LLM)

## Design

### Why native-only

The summarize tool calls the sub-agent LLM, which lives in the parent process. The Deno sandbox can't invoke it through IPC — the tool registry dispatches to handler functions, but the sub-agent is an async LLM call that returns text. The IPC protocol supports it (tool calls return results), so actually this *could* work through sandbox dispatch.

Wait — re-examining: the sandbox calls `tools.summarize(...)` → IPC → parent process handler → `deps.subAgent.complete()` → returns text. That does work through the existing IPC protocol. The handler is just a function that happens to call an LLM internally.

**Revised: `mode: 'both'`.** Available as native tool_use (simple direct calls) and via sandbox stubs (composable in execute_code — e.g., fetch page then summarize in one call).

### Tool: `summarize`

### Parameters

- `text` (string, required) — content to summarize, truncated at 100k chars
- `instructions` (string, optional) — focus guidance (e.g., "focus on technical claims")
- `max_length` (string, optional) — `"short"` | `"medium"` | `"long"`, default `"medium"`

### Length Guidance

- `short` → "Respond in 2-3 sentences."
- `medium` → "Respond in 1-2 paragraphs."
- `long` → "Respond in up to 4 paragraphs."

### Implementation

```typescript
async function summarize(params, deps): Promise<{ summary: string }> {
  if (!deps.subAgent) {
    throw new Error('Sub-agent LLM not configured. Add [sub_model] to config.toml.');
  }

  const text = str(params, 'text').slice(0, 100_000);
  const instructions = optStr(params, 'instructions');
  const maxLength = optStr(params, 'max_length', 'medium');

  const lengthGuide: Record<string, string> = {
    short: 'Respond in 2-3 sentences.',
    medium: 'Respond in 1-2 paragraphs.',
    long: 'Respond in up to 4 paragraphs.',
  };

  let prompt = `Summarize the following text. ${lengthGuide[maxLength] ?? lengthGuide.medium}`;
  if (instructions) {
    prompt += `\n\nFocus: ${instructions}`;
  }
  prompt += `\n\n---\n\n${text}`;

  const system = 'You are a precise summarization assistant. Preserve key facts, names, and numbers. Do not add information not present in the source text.';

  const result = await deps.subAgent.complete(prompt, system);
  return { summary: result };
}
```

### Registration

New file `src/tools/summarize.ts` exporting:

```typescript
function registerSummarizeTools(registry: ToolRegistry, deps: AgentDependencies): void
```

Called from `createAgentTools()` in `src/agent/tools.ts`. Mode: `'both'`.

## Files Touched

- `src/tools/summarize.ts` — new file, tool definition + handler
- `src/agent/tools.ts` �� call `registerSummarizeTools(registry, deps)`

## Acceptance Criteria

1. `summarize` sends text to sub-agent with appropriate system prompt
2. Input truncated at 100k chars
3. `max_length` maps to correct length guidance
4. Optional `instructions` appended to prompt as focus guidance
5. Missing sub-agent → clear error message
6. Registered as `mode: 'both'` — native tool_use + sandbox stubs
7. Test: mock sub-agent, verify prompt construction includes length guidance
8. Test: mock sub-agent, verify instructions appended when provided
9. Test: no sub-agent configured → verify error thrown
