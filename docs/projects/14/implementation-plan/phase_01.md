# GH14: Standalone Secrets Management — Implementation Plan

**Goal:** Make `SecretManager.set()` and `remove()` return `Promise<void>` so callers can await persistence, and add integration tests verifying the full lifecycle.

**Architecture:** Minimal change to the existing `SecretManager` closure in `src/secrets/manager.ts`. The internal `save()` function becomes async and is awaited by `set()` and `remove()`. The type definition updates accordingly. Existing callers that ignore the return value remain unaffected (returning a `Promise<void>` where `void` was returned before is backward-compatible in TypeScript).

**Tech Stack:** Bun (runtime + test runner), `node:fs/promises`

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH14.AC1: Awaitable persistence
- **GH14.AC1.1 Success:** `set()` and `remove()` return `Promise<void>`

### GH14.AC2: Persistence correctness
- **GH14.AC2.1 Success:** After `await manager.set('FOO', 'bar')`, reading `data/secrets.json` shows `{ "FOO": "bar" }`

### GH14.AC3: Resolve behaviour
- **GH14.AC3.1 Success:** `resolve(['FOO', 'MISSING'])` returns `{ FOO: 'bar' }` (skips missing keys)

### GH14.AC4: Backward compatibility
- **GH14.AC4.1 Success:** Existing callers unaffected (returned promise can be ignored for backward compat)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Update `SecretManager` type and implementation for awaitable persistence

**Verifies:** GH14.AC1.1, GH14.AC4.1

**Files:**
- Modify: `src/secrets/manager.ts`

**Implementation:**

Two changes to `src/secrets/manager.ts`:

**Change 1: Update the `SecretManager` type (lines 17, 19)**

Replace the current synchronous signatures:

```typescript
/** Set a secret. */
set(key: string, value: string): void;
/** Delete a secret. */
remove(key: string): void;
```

With async signatures:

```typescript
/** Set a secret. Resolves when persisted to disk. */
set(key: string, value: string): Promise<void>;
/** Delete a secret. Resolves when persisted to disk. */
remove(key: string): Promise<void>;
```

**Change 2: Make `save()` awaitable and `set()`/`remove()` async (lines 40-62)**

Replace the current fire-and-forget `save()` and the `set()`/`remove()` methods:

```typescript
// Current (fire-and-forget):
function save(): void {
  mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, JSON.stringify(secrets, null, 2) + '\n'))
    .catch(() => {});
}

// ...
set(key: string, value: string): void {
  secrets[key] = value;
  save();
},

remove(key: string): void {
  delete secrets[key];
  save();
},
```

With:

```typescript
async function save(): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(secrets, null, 2) + '\n');
}

// ...
async set(key: string, value: string): Promise<void> {
  secrets[key] = value;
  await save();
},

async remove(key: string): Promise<void> {
  delete secrets[key];
  await save();
},
```

Note: error handling is intentionally removed from `save()`. The design specifies that callers should now see errors rather than swallowing them. If `writeFile` fails, the promise rejects and the caller gets the error. The in-memory state is still updated (consistent with prior behaviour where the in-memory update succeeded even if save failed).

**Verification:**

Run: `bun run build`
Expected: Builds without errors. The existing callers in `src/tui/ReviewPage.tsx` (lines 170, 195) call `secrets.set()` and `secrets.remove()` without `await` — this is valid TypeScript since ignoring a `Promise<void>` return is permitted.

**Commit:** `feat(secrets): make set() and remove() return Promise<void> for awaitable persistence`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add integration tests for SecretManager lifecycle

**Verifies:** GH14.AC1.1, GH14.AC2.1, GH14.AC3.1, GH14.AC4.1

**Files:**
- Create: `src/secrets/manager.test.ts`

**Implementation:**

This is the first test file in the project. Uses Bun's built-in test runner (`bun test`), which auto-discovers `*.test.ts` files. Bun's test API uses `describe`, `test`/`it`, and `expect` — no imports needed for these globals (they're injected by the Bun test runner).

Create `src/secrets/manager.test.ts` with these test cases:

```typescript
// Integration tests for SecretManager — verifies persistence lifecycle against real filesystem.

import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSecretManager } from './manager.ts';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

const TEST_DIR = join(import.meta.dir, '../../.test-tmp');
const TEST_PATH = join(TEST_DIR, 'secrets.json');

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true });
  } catch {
    // ignore if doesn't exist
  }
}

describe('SecretManager', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test('set() persists to JSON file on disk', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('FOO', 'bar');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ FOO: 'bar' });
  });

  test('set() returns a Promise', () => {
    const mgr = createSecretManager(TEST_PATH);
    const result = mgr.set('X', 'Y');
    expect(result).toBeInstanceOf(Promise);
  });

  test('remove() returns a Promise', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('X', 'Y');
    const result = mgr.remove('X');
    expect(result).toBeInstanceOf(Promise);
  });

  test('get() retrieves a previously set value', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('TOKEN', 'abc123');
    expect(mgr.get('TOKEN')).toBe('abc123');
  });

  test('get() returns undefined for missing keys', () => {
    const mgr = createSecretManager(TEST_PATH);
    expect(mgr.get('NONEXISTENT')).toBeUndefined();
  });

  test('remove() deletes a secret and persists', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('DEL_ME', 'gone');
    await mgr.remove('DEL_ME');

    expect(mgr.get('DEL_ME')).toBeUndefined();

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({});
  });

  test('listKeys() returns sorted key names', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('ZEBRA', 'z');
    await mgr.set('ALPHA', 'a');
    await mgr.set('MIDDLE', 'm');

    expect(mgr.listKeys()).toEqual(['ALPHA', 'MIDDLE', 'ZEBRA']);
  });

  test('resolve() returns env map for existing keys, skips missing', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('FOO', 'bar');
    await mgr.set('BAZ', 'qux');

    const env = mgr.resolve(['FOO', 'MISSING', 'BAZ']);
    expect(env).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  test('resolve() returns empty object when no keys match', () => {
    const mgr = createSecretManager(TEST_PATH);
    const env = mgr.resolve(['NOTHING', 'NOPE']);
    expect(env).toEqual({});
  });

  test('new manager loads persisted secrets from disk', async () => {
    const mgr1 = createSecretManager(TEST_PATH);
    await mgr1.set('PERSIST', 'across-instances');

    const mgr2 = createSecretManager(TEST_PATH);
    expect(mgr2.get('PERSIST')).toBe('across-instances');
    expect(mgr2.listKeys()).toEqual(['PERSIST']);
  });

  test('set() overwrites existing value', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('KEY', 'old');
    await mgr.set('KEY', 'new');

    expect(mgr.get('KEY')).toBe('new');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ KEY: 'new' });
  });

  test('creates parent directory if it does not exist', async () => {
    const nested = join(TEST_DIR, 'deep', 'nested', 'secrets.json');
    const mgr = createSecretManager(nested);
    await mgr.set('DEEP', 'value');

    const raw = readFileSync(nested, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ DEEP: 'value' });
  });

  test('ignoring returned promise does not throw (backward compat)', () => {
    const mgr = createSecretManager(TEST_PATH);
    // Existing callers call set()/remove() without await — this must not throw
    mgr.set('IGNORED', 'promise');
    mgr.remove('IGNORED');
    // If we get here without error, backward compat is satisfied
  });
});
```

**Testing:**

Tests verify each AC:
- **GH14.AC1.1:** `set()` and `remove()` return `Promise` instances (tested via `toBeInstanceOf(Promise)`)
- **GH14.AC2.1:** After `await mgr.set('FOO', 'bar')`, reading the file shows `{ FOO: 'bar' }` (tested via `readFileSync` + `JSON.parse`)
- **GH14.AC3.1:** `resolve(['FOO', 'MISSING'])` returns `{ FOO: 'bar' }` — skips missing keys (tested directly)
- **GH14.AC4.1:** Calling `set()`/`remove()` without `await` does not throw (backward compat test)

**Verification:**

Run: `bun test`
Expected: All tests pass. Output shows discovered `src/secrets/manager.test.ts`.

**Commit:** `test(secrets): add integration tests for SecretManager lifecycle`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify build and full test suite

**Files:**
- None (verification only)

**Verification:**

Run: `bun run build`
Expected: Builds without errors.

Run: `bun test`
Expected: All tests pass.

Verify backward compatibility by inspection: confirm that `src/tui/ReviewPage.tsx` still compiles (it calls `secrets.set()` and `secrets.remove()` without `await` at lines 195 and 170 respectively — this is valid because the promise is simply discarded).

**Commit:** No commit needed — this is a verification step.

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
