# GH06: Outbound Notification Tool (Discord Webhook) — Phase 2

**Goal:** Add unit tests for the `notify_discord` tool covering all acceptance criteria.

**Architecture:** Tests use Bun's built-in test runner (`bun test`). The `notify_discord` handler is exercised through the `ToolRegistry.execute()` interface, with `fetch` mocked via `mock.module` or a manual global override. A minimal `AgentDependencies` stub provides a fake `SecretManager`.

**Tech Stack:** Bun test runner, TypeScript

**Scope:** 2 phases from design (Phase 1: implementation, Phase 2: tests)

**Codebase verified:** 2026-04-27

**Testing note:** This project has no existing test files. This phase establishes the first test file. Bun's test runner auto-discovers `*.test.ts` files. No additional configuration is required beyond `bun test`.

---

## Acceptance Criteria Coverage

This phase tests:

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

### GH06.AC7: Test — plain message
- **GH06.AC7.1:** Mock fetch, verify plain message payload

### GH06.AC8: Test — embed
- **GH06.AC8.1:** Mock fetch, verify embed payload when title provided

### GH06.AC9: Test — missing secret
- **GH06.AC9.1:** Missing secret returns error string

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create test helpers — minimal AgentDependencies stub

**Files:**
- Create: `src/tools/__tests__/helpers.ts`

**Implementation:**

The `registerNotifyTools` function requires `AgentDependencies` (specifically the `secrets` field). Tests need a minimal stub that satisfies the type without requiring real SQLite, model providers, or runtimes.

Create a helper that builds a partial `AgentDependencies` with only the fields the notify tool uses. The key dependency is `secrets: SecretManager` — the rest can be `undefined as any` since the notify handler never touches them.

```typescript
// Test helper — minimal AgentDependencies for notify tool tests

import type { AgentDependencies } from '../../agent/types.ts';
import type { SecretManager } from '../../secrets/manager.ts';

export function makeSecretManager(
  secrets: Record<string, string> = {},
): SecretManager {
  return {
    listKeys: () => Object.keys(secrets),
    get: (key: string) => secrets[key],
    set: () => {},
    remove: () => {},
    resolve: (keys: ReadonlyArray<string>) => {
      const env: Record<string, string> = {};
      for (const key of keys) {
        const val = secrets[key];
        if (val !== undefined) env[key] = val;
      }
      return env;
    },
  };
}

export function makeDeps(
  overrides: { secrets?: SecretManager } = {},
): Readonly<AgentDependencies> {
  return {
    secrets: overrides.secrets,
    // These are never accessed by notify_discord — stub them out
    model: undefined as any,
    runtime: undefined as any,
    config: undefined as any,
    personaPath: '',
    store: undefined as any,
  };
}
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Write `notify_discord` tests

**Verifies:** GH06.AC1.1, GH06.AC2.1, GH06.AC3.1, GH06.AC4.1, GH06.AC5.1, GH06.AC7.1, GH06.AC8.1, GH06.AC9.1

**Files:**
- Create: `src/tools/__tests__/notify.test.ts`

**Implementation:**

This is the first test file in the project. Use Bun's built-in test primitives: `describe`, `test`, `expect`, `beforeEach`, `afterEach` from `bun:test`.

The testing strategy: `registerNotifyTools` registers a handler into a real `ToolRegistry` instance. Call `registry.execute('notify_discord', params)` to invoke the handler. Mock `globalThis.fetch` to capture the outgoing request and return a controlled response.

Tests to write:

1. **GH06.AC2.1 / GH06.AC9.1 — missing secret returns error string:**
   - Create deps with no secrets (or secrets without `DISCORD_WEBHOOK_URL`)
   - Execute `notify_discord` with `{ content: 'hello' }`
   - Assert result is a string containing `'DISCORD_WEBHOOK_URL'` and `'not configured'`
   - Assert `fetch` was NOT called

2. **GH06.AC3.1 / GH06.AC7.1 — plain message payload:**
   - Create deps with `DISCORD_WEBHOOK_URL` secret set to `'https://discord.test/webhook'`
   - Mock `fetch` to return `{ ok: true, status: 204 }`
   - Execute `notify_discord` with `{ content: 'hello world' }`
   - Assert `fetch` was called with the webhook URL
   - Assert request body is `{ content: 'hello world' }` (plain message, no embeds)
   - Assert `Content-Type` header is `application/json`
   - Assert result is `'Notification sent.'`

3. **GH06.AC4.1 / GH06.AC8.1 — embed payload when title provided:**
   - Same deps setup
   - Execute with `{ content: 'details here', title: 'Alert' }`
   - Assert request body is `{ embeds: [{ title: 'Alert', description: 'details here' }] }`
   - Assert result is `'Notification sent.'`

4. **GH06.AC5.1 — content truncated to 2000 chars:**
   - Execute with `{ content: 'a'.repeat(3000) }`
   - Assert the `content` field in the request body is exactly 2000 chars
   - Execute with `{ content: 'b'.repeat(3000), title: 'Long' }`
   - Assert the `description` field in the embed is exactly 2000 chars

5. **Webhook error response:**
   - Mock `fetch` to return `{ ok: false, status: 500, text: () => 'Internal Server Error' }`
   - Execute `notify_discord` with `{ content: 'test' }`
   - Assert result string contains `'500'` and `'Internal Server Error'`

**Fetch mocking approach:**

Before each test, save the original `globalThis.fetch` and replace it with a mock. After each test, restore the original. The mock captures the `Request` or URL + init args for assertion.

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createToolRegistry } from '../../runtime/tool-registry.ts';
import { registerNotifyTools } from '../notify.ts';
import { makeDeps, makeSecretManager } from './helpers.ts';

describe('notify_discord', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body = '', ok?: boolean) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init: init ?? {} });
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain' },
      });
    };
  }

  function setup(secrets: Record<string, string> = {}) {
    const registry = createToolRegistry();
    const deps = makeDeps({
      secrets: Object.keys(secrets).length > 0
        ? makeSecretManager(secrets)
        : undefined,
    });
    registerNotifyTools(registry, deps);
    return registry;
  }

  test('returns error when DISCORD_WEBHOOK_URL secret is missing', async () => {
    const registry = setup();
    const result = await registry.execute('notify_discord', { content: 'hello' });
    expect(result).toContain('DISCORD_WEBHOOK_URL');
    expect(result).toContain('not configured');
    expect(fetchCalls).toHaveLength(0);
  });

  test('returns error when secrets manager exists but key is missing', async () => {
    const registry = setup({ OTHER_KEY: 'value' });
    const result = await registry.execute('notify_discord', { content: 'hello' });
    expect(result).toContain('DISCORD_WEBHOOK_URL');
    expect(result).toContain('not configured');
    expect(fetchCalls).toHaveLength(0);
  });

  test('sends plain message payload without title', async () => {
    const webhookUrl = 'https://discord.test/webhook';
    const registry = setup({ DISCORD_WEBHOOK_URL: webhookUrl });
    mockFetch(204);

    const result = await registry.execute('notify_discord', {
      content: 'hello world',
    });

    expect(result).toBe('Notification sent.');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(webhookUrl);

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body).toEqual({ content: 'hello world' });
    expect(body.embeds).toBeUndefined();

    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('sends embed payload when title is provided', async () => {
    const webhookUrl = 'https://discord.test/webhook';
    const registry = setup({ DISCORD_WEBHOOK_URL: webhookUrl });
    mockFetch(204);

    const result = await registry.execute('notify_discord', {
      content: 'details here',
      title: 'Alert',
    });

    expect(result).toBe('Notification sent.');
    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body).toEqual({
      embeds: [{ title: 'Alert', description: 'details here' }],
    });
    expect(body.content).toBeUndefined();
  });

  test('truncates content to 2000 chars in plain message', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(204);

    await registry.execute('notify_discord', {
      content: 'a'.repeat(3000),
    });

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body.content).toHaveLength(2000);
  });

  test('truncates content to 2000 chars in embed description', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(204);

    await registry.execute('notify_discord', {
      content: 'b'.repeat(3000),
      title: 'Long Content',
    });

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body.embeds[0].description).toHaveLength(2000);
  });

  test('returns error string on webhook failure', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(500, 'Internal Server Error');

    const result = await registry.execute('notify_discord', {
      content: 'test',
    });

    expect(result).toContain('500');
    expect(result).toContain('Internal Server Error');
  });
});
```

**Verification:**
Run: `bun test`
Expected: All 7 tests pass

**Commit:** `test(notify): add unit tests for notify_discord tool`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
