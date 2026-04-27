# #5 — Auto-Generated Session Titles

**Issue:** https://github.com/Numina-Systems/johnson/issues/5
**Wave:** 2 (depends on: #4 sub-agent LLM)

## Design

### New Module

`src/agent/session-title.ts` — single exported function:

```typescript
async function maybeGenerateSessionTitle(
  store: Store,
  sessionId: string | undefined,
  subAgent: SubAgentLLM | undefined,
  messages: ReadonlyArray<Message>,
): Promise<void>
```

### Guards (skip silently)

- `subAgent` is undefined (no sub-model configured)
- `sessionId` is undefined (no session tracking)
- Session already has a non-empty title
- Fewer than 2 user messages in `messages`

### Title Generation

1. Take first 10 messages from `messages`
2. Format as `"role: content"` lines, truncating each message content to 200 chars
3. Call sub-agent:
   ```
   prompt: <formatted messages>
   system: "Summarize the topic of this short conversation as a concise title (5-8 words, no quotes, no trailing punctuation, plain text only). Respond with only the title."
   ```
4. Post-process result:
   - Strip leading/trailing quotes (single and double)
   - Strip trailing punctuation (`.`, `!`, `?`)
   - Take first line only (in case model returns multi-line)
   - Trim whitespace
   - Truncate to 80 chars
5. Persist: `store.updateSessionTitle(sessionId, title)`

### Integration

In `src/agent/agent.ts`, at the end of `_chatImpl` (after building the return value, before the `return`):

```typescript
// Fire-and-forget — don't block the response
maybeGenerateSessionTitle(deps.store, options?.sessionId, deps.subAgent, history).catch(() => {});
```

### ChatOptions Update

Add `sessionId?: string` to `ChatOptions` in `src/agent/types.ts`:

```typescript
type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
  readonly onEvent?: (event: AgentEvent) => Promise<void>;
  readonly sessionId?: string;
};
```

Callers (TUI, Discord) pass the session ID when they have one.

## Files Touched

- `src/agent/session-title.ts` — new file
- `src/agent/types.ts` — add `sessionId` to `ChatOptions`
- `src/agent/agent.ts` — call `maybeGenerateSessionTitle` at end of `_chatImpl`

## Acceptance Criteria

1. Title generated only when: sub-agent available, session has no title, 2+ user messages
2. Sub-agent called with first 10 messages formatted as text
3. Result post-processed: quotes stripped, punctuation stripped, first line, 80 char cap
4. Title persisted via `store.updateSessionTitle()`
5. Non-blocking — errors swallowed silently
6. `sessionId` available on `ChatOptions`
7. Test: mock sub-agent returns title → verify store updated
8. Test: session already has title → verify sub-agent not called
9. Test: fewer than 2 user messages → verify sub-agent not called
