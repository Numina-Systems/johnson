# GH06: Outbound Notification Tool (Discord Webhook) — Phase 1

**Goal:** Add a `notify_discord` tool that POSTs messages to a Discord webhook URL resolved from the secrets manager.

**Architecture:** A new `src/tools/notify.ts` module exports a `registerNotifyTools()` function that registers the `notify_discord` tool into the existing `ToolRegistry`. The tool reads the webhook URL from `deps.secrets`, builds either a plain-message or embed payload, POSTs it via `fetch`, and returns a status string. Registration is called from `createAgentTools()` in `src/agent/tools.ts`.

**Tech Stack:** TypeScript (Bun runtime), existing `ToolRegistry` from `src/runtime/tool-registry.ts`, `SecretManager` from `src/secrets/manager.ts`, global `fetch`.

**Scope:** 2 phases from design (Phase 1: implementation, Phase 2: tests)

**Codebase verified:** 2026-04-27

**Dependency note:** The design specifies `mode: 'both'` registration (native tool_use + sandbox stubs). The multi-tool architecture (#3) that adds `mode` support to the registry has NOT been implemented yet. This phase registers `notify_discord` as a standard sandbox tool (the only mode the current registry supports). When #3 lands, the `register()` call in `registerNotifyTools()` will need a fourth argument: `'both'`. A `// TODO(GH03)` comment marks this callsite.

---

## Acceptance Criteria Coverage

This phase implements:

### GH06.AC1: Webhook POST
- **GH06.AC1.1:** `notify_discord` POSTs to webhook URL from secrets

### GH06.AC2: Missing secret handling
- **GH06.AC2.1:** Missing secret returns a clear error message (not a thrown error)

### GH06.AC3: Plain message payload
- **GH06.AC3.1:** Without title: sends `{ content }` payload

### GH06.AC4: Embed payload
- **GH06.AC4.1:** With title: sends `{ embeds: [{ title, description }] }` payload

### GH06.AC5: Content truncation
- **GH06.AC5.1:** Content truncated to 2000 chars

### GH06.AC6: Registry mode
- **GH06.AC6.1:** Registered as sandbox tool (native/both deferred to #3)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tools/notify.ts`

**Verifies:** GH06.AC1.1, GH06.AC2.1, GH06.AC3.1, GH06.AC4.1, GH06.AC5.1

**Files:**
- Create: `src/tools/notify.ts`

**Implementation:**

Create a new file at `src/tools/notify.ts`. This module follows the `// pattern: Functional Core` convention used by `src/agent/tools.ts`.

The module exports a single function `registerNotifyTools(registry, deps)` that registers one tool: `notify_discord`.

The tool handler:
1. Reads `DISCORD_WEBHOOK_URL` from `deps.secrets?.get('DISCORD_WEBHOOK_URL')`
2. If the secret is missing (or `deps.secrets` is undefined), returns an error string (does NOT throw)
3. Extracts `content` (required string) and `title` (optional string) from params
4. Truncates `content` to 2000 characters
5. Builds the JSON body:
   - If `title` is provided: `{ embeds: [{ title, description: content }] }`
   - Otherwise: `{ content }`
6. POSTs to the webhook URL with `Content-Type: application/json`
7. If the response is not OK, returns an error string with the status and response text
8. On success, returns `'Notification sent.'`

Parameter extraction should use the same `str()` and `optStr()` helper pattern from `src/agent/tools.ts`. Since these helpers are not exported, duplicate them locally. They are small (2-3 lines each) and the alternative (a shared module) is premature extraction for two call sites.

```typescript
// pattern: Functional Core — notify tool registration

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === 'string' ? val : undefined;
}

export function registerNotifyTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  // TODO(GH03): Add mode: 'both' when multi-tool architecture lands
  registry.register(
    'notify_discord',
    {
      name: 'notify_discord',
      description:
        'Send a message to Discord via webhook. Requires DISCORD_WEBHOOK_URL secret. ' +
        'If title is provided, sends as a rich embed; otherwise sends as a plain message. ' +
        'Content is truncated to 2000 characters.',
      input_schema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Message body (truncated to 2000 chars)',
          },
          title: {
            type: 'string',
            description: 'Optional title — if provided, sends as a Discord embed instead of plain message',
          },
        },
        required: ['content'],
      },
    },
    async (params) => {
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
    },
  );
}
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(notify): add notify_discord tool handler`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register notify tools in `createAgentTools()`

**Verifies:** GH06.AC6.1

**Files:**
- Modify: `src/agent/tools.ts`

**Implementation:**

Two changes to `src/agent/tools.ts`:

1. Add an import at the top of the file (after the existing imports, around line 7):

```typescript
import { registerNotifyTools } from '../tools/notify.ts';
```

2. Call `registerNotifyTools` at the end of `createAgentTools()`, just before the `return registry;` statement (currently line 327):

```typescript
  // ── Notification tools ───────────────────────────────────────────────────
  registerNotifyTools(registry, deps);

  return registry;
```

This follows the existing pattern where all tool registrations happen inside `createAgentTools()` before returning the registry. The `registerNotifyTools` function receives the same `registry` and `deps` that the built-in tools use.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun run build`
Expected: Build succeeds

**Commit:** `feat(notify): wire notify_discord into agent tool registry`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Manual smoke test (optional)

**Files:** None modified

**Step 1:** Add a `DISCORD_WEBHOOK_URL` secret via the TUI (`/review` or direct edit of `data/secrets.json`):
```json
{
  "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN"
}
```

**Step 2:** Start the agent and ask it to send a notification:
```
bun start
```
Then in the chat, type: "Send a test notification to Discord saying hello"

**Step 3:** Verify the message appears in the Discord channel.

**Step 4:** Ask it to send an embed: "Send a Discord notification with title 'Test Alert' and content 'This is a test embed'"

**Step 5:** Verify the embed appears in the Discord channel.

This step is optional and only needed if you have a Discord webhook URL available.
<!-- END_TASK_3 -->
