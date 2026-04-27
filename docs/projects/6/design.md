# #6 — Outbound Notification Tool (Discord Webhook)

**Issue:** https://github.com/Numina-Systems/johnson/issues/6
**Wave:** 2 (depends on: #3 registry mode, #14 secrets)

## Design

### Tool: `notify_discord`

Fire-and-forget webhook POST. Registered as `mode: 'both'` — available as native tool_use (no composition value for direct calls) and also via sandbox stubs (scheduled tasks composing multiple operations may want to notify as a final step inside execute_code).

### Parameters

- `content` (string, required) — message body, truncated to 2000 chars
- `title` (string, optional) — if provided, sends as Discord embed instead of plain message

### Implementation

```typescript
async function notifyDiscord(params, deps): Promise<string> {
  const webhookUrl = deps.secrets?.get('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) {
    return 'Error: DISCORD_WEBHOOK_URL secret not configured. Add it via the TUI secrets screen.';
  }

  const content = str(params, 'content').slice(0, 2000);
  const title = optStr(params, 'title');

  const body = title
    ? { embeds: [{ title, description: content }] }
    : { content };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return `Error: Discord webhook returned ${response.status}: ${await response.text()}`;
  }

  return 'Notification sent.';
}
```

### Secret Resolution

Webhook URL from `deps.secrets?.get('DISCORD_WEBHOOK_URL')`. Clear error message if not configured — no env var fallback (webhook URLs are secrets, not config).

### Registration

New file `src/tools/notify.ts` exporting:

```typescript
function registerNotifyTools(registry: ToolRegistry, deps: AgentDependencies): void
```

Called from `createAgentTools()` in `src/agent/tools.ts`. Mode: `'both'`.

## Files Touched

- `src/tools/notify.ts` — new file, single tool definition + handler
- `src/agent/tools.ts` — call `registerNotifyTools(registry, deps)`

## Acceptance Criteria

1. `notify_discord` POSTs to webhook URL from secrets
2. Missing secret → clear error message (not a thrown error)
3. Plain message: `{ content }` payload
4. With title: `{ embeds: [{ title, description }] }` payload
5. Content truncated to 2000 chars
6. Registered as `mode: 'both'` — native tool_use definition + sandbox stubs
7. Test: mock fetch, verify plain message payload
8. Test: mock fetch, verify embed payload when title provided
9. Test: missing secret → verify error string returned
