# #14 — Standalone Secrets Management

**Issue:** https://github.com/Numina-Systems/johnson/issues/14
**Wave:** 0 (no dependencies)
**Status:** Mostly complete — extending existing implementation

## Current State

`src/secrets/manager.ts` already implements the full `SecretManager` interface:
- `listKeys()` — sorted array of secret names (never values)
- `get(key)` — returns value (internal use only — env injection)
- `set(key, value)` — create/update + persist
- `remove(key)` — delete + persist
- `resolve(keys)` — bulk resolve to env var map

Storage: `data/secrets.json` (flat JSON key-value pairs). Already wired into `src/index.ts` and passed to agents via `AgentDependencies`.

## Design

### Change: Make persistence awaitable

Currently `set()` and `remove()` call an internal `save()` that is fire-and-forget (`writeFile` with `.catch(() => {})`). New consumers (TUI secrets screen, custom tools) need to know when persistence completes.

**Change `set()` and `remove()` signatures to return `Promise<void>`.**

Internally, replace the fire-and-forget `save()` with a direct `await writeFile(...)`. The `mkdir` call stays (ensures `data/` exists on first write).

### No other changes needed

- Type is already exported from `src/secrets/index.ts`
- Already usable by new consumers (web tools, notify tool, custom tools will call `deps.secrets?.get('KEY_NAME')`)
- TUI secrets screen is #13's responsibility

## Files Touched

- `src/secrets/manager.ts` — make `set`/`remove` return `Promise<void>`
- New test file for integration test (set/get/remove/resolve, verify JSON on disk)

## Acceptance Criteria

1. `set()` and `remove()` return `Promise<void>`
2. After `await manager.set('FOO', 'bar')`, reading `data/secrets.json` shows `{ "FOO": "bar" }`
3. `resolve(['FOO', 'MISSING'])` returns `{ FOO: 'bar' }` (skips missing keys)
4. Existing callers unaffected (returned promise can be ignored for backward compat)
