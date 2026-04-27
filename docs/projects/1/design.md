# #1 — Graceful Max-Iteration Exhaustion

**Issue:** https://github.com/Numina-Systems/johnson/issues/1
**Wave:** 0 (no dependencies)

## Current State

When `maxToolRounds` is hit, the for-loop in `_chatImpl` exits silently. The text extraction logic at the end grabs whatever was in the last assistant message — often a `tool_use` block with no text, or mid-thought content.

## Design

### Flag-based detection

Add a `let exitedNormally = false` flag before the for-loop. Set it `true` inside the `end_turn`/`max_tokens` break (line ~183). After the for-loop, check the flag.

### Forced final response

If `!exitedNormally`:

1. Push a system nudge as a user message:
   ```
   history.push({ role: 'user', content: '[System: Max tool calls reached. Provide final response now.]' });
   ```

2. Make one final model call with **no tools**:
   ```
   const finalResponse = await deps.model.complete({
     system: systemPrompt,
     messages: history,
     tools: [],          // forces text-only response
     model: deps.config.model,
     max_tokens: deps.config.maxTokens,
     temperature: deps.config.temperature,
     timeout: deps.config.modelTimeout,
   });
   ```

3. Accumulate usage stats:
   ```
   rounds++;
   totalInputTokens += finalResponse.usage.input_tokens;
   totalOutputTokens += finalResponse.usage.output_tokens;
   ```

4. Push final assistant response to history:
   ```
   history.push({ role: 'assistant', content: finalResponse.content });
   ```

5. Existing text extraction logic at the end of `_chatImpl` handles the rest — it finds the last assistant message and extracts text blocks.

### Why `tools: []` works

With no tools in the request, the model cannot return `tool_use` blocks. It must produce text. This guarantees a coherent wrap-up response.

## Files Touched

- `src/agent/agent.ts` — ~20 lines after the for-loop

## Acceptance Criteria

1. When maxToolRounds exhausted, a system nudge message appears in history
2. A final model call with `tools: []` produces a text response
3. Usage stats from the final call are included in `ChatStats`
4. `rounds` count includes the final call
5. Test: mock model that always returns `tool_use` → verify final forced text response after maxToolRounds
