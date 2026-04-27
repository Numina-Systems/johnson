# #2 — Event Emission / Lifecycle Hooks

**Issue:** https://github.com/Numina-Systems/johnson/issues/2
**Wave:** 1 (no hard dependencies)

## Current State

`chat()` is a black box. Callers await it and get `ChatResult`. No visibility into what's happening mid-loop — TUI shows a generic "Thinking..." spinner with no granularity.

## Design

### Event Types

In `src/agent/types.ts`:

```typescript
type AgentEventKind = 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done';

type AgentEvent = {
  readonly kind: AgentEventKind;
  readonly data: Record<string, unknown>;
};
```

### Callback on ChatOptions

Add to `ChatOptions`:

```typescript
type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
  readonly onEvent?: (event: AgentEvent) => Promise<void>;
};
```

### Emit Helper

In `_chatImpl`, create a local helper:

```typescript
const emit = async (kind: AgentEventKind, data: Record<string, unknown>): Promise<void> => {
  if (!options?.onEvent) return;
  try {
    await options.onEvent({ kind, data });
  } catch (err) {
    process.stderr.write(`[agent] event callback error (${kind}): ${err}\n`);
  }
};
```

Events are **awaited** so the UI can update synchronously before the next step. If the callback throws, log and continue — events never kill the agent loop.

### Emit Points

Four points in the tool loop:

1. **Before `model.complete()`:**
   ```
   await emit('llm_start', { round });
   ```

2. **After `model.complete()`:**
   ```
   await emit('llm_done', { round, usage: response.usage, stop_reason: response.stop_reason });
   ```

3. **Before `runtime.execute()`:**
   ```
   await emit('tool_start', { tool: 'execute_code', code: code.slice(0, 500) });
   ```

4. **After `runtime.execute()`:**
   ```
   await emit('tool_done', { tool: 'execute_code', success: result.success, preview: (result.output ?? '').slice(0, 200) });
   ```

### Also emit for the max-iteration final call (#1)

If #1 is merged first, also emit `llm_start`/`llm_done` around the forced final response call.

### Future: native tool events (#3)

Once multi-tool architecture lands, `tool_start`/`tool_done` also fire for native tool calls. The `tool` field in `data` carries the tool name instead of `'execute_code'`. The interface is identical — no changes needed to the event types.

## Files Touched

- `src/agent/types.ts` — add `AgentEvent`, `AgentEventKind`, update `ChatOptions`
- `src/agent/agent.ts` — add emit helper, four emit calls in tool loop

## Acceptance Criteria

1. `AgentEvent` and `AgentEventKind` types exported
2. `onEvent` callback on `ChatOptions` is optional
3. All four events fire in order: `llm_start` → `llm_done` → `tool_start` → `tool_done`
4. Callback errors are logged, not thrown
5. Code preview in `tool_start` truncated to 500 chars
6. Result preview in `tool_done` truncated to 200 chars
7. Test: provide `onEvent` callback, run chat with tool use, verify all four event kinds fire in correct order
