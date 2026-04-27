# GH14: Standalone Secrets Management — Test Requirements

Maps each acceptance criterion to automated tests or human verification.

---

## Automated Tests

All acceptance criteria for GH14 are verifiable via automated tests.

| Criterion | Description | Test Type | Test File | Test Name(s) |
|-----------|-------------|-----------|-----------|---------------|
| GH14.AC1.1 | `set()` and `remove()` return `Promise<void>` | Unit | `src/secrets/manager.test.ts` | `set() returns a Promise`, `remove() returns a Promise` |
| GH14.AC2.1 | After `await manager.set('FOO', 'bar')`, reading `data/secrets.json` shows `{ "FOO": "bar" }` | Integration | `src/secrets/manager.test.ts` | `set() persists to JSON file on disk` |
| GH14.AC3.1 | `resolve(['FOO', 'MISSING'])` returns `{ FOO: 'bar' }` (skips missing keys) | Unit | `src/secrets/manager.test.ts` | `resolve() returns env map for existing keys, skips missing` |
| GH14.AC4.1 | Existing callers unaffected (returned promise can be ignored) | Unit | `src/secrets/manager.test.ts` | `ignoring returned promise does not throw (backward compat)` |

## Additional Coverage

These tests go beyond the minimum acceptance criteria to ensure robustness:

| Behaviour | Test File | Test Name |
|-----------|-----------|-----------|
| `get()` retrieves set values | `src/secrets/manager.test.ts` | `get() retrieves a previously set value` |
| `get()` returns undefined for missing keys | `src/secrets/manager.test.ts` | `get() returns undefined for missing keys` |
| `remove()` deletes and persists | `src/secrets/manager.test.ts` | `remove() deletes a secret and persists` |
| `listKeys()` returns sorted names | `src/secrets/manager.test.ts` | `listKeys() returns sorted key names` |
| `resolve()` returns empty for no matches | `src/secrets/manager.test.ts` | `resolve() returns empty object when no keys match` |
| New instance loads persisted data | `src/secrets/manager.test.ts` | `new manager loads persisted secrets from disk` |
| `set()` overwrites existing values | `src/secrets/manager.test.ts` | `set() overwrites existing value` |
| Parent directory auto-created | `src/secrets/manager.test.ts` | `creates parent directory if it does not exist` |

## Human Verification

| Criterion | Verification Approach | Justification |
|-----------|----------------------|---------------|
| GH14.AC4.1 | Verify `src/tui/ReviewPage.tsx` compiles — lines 170 and 195 call `secrets.remove()` / `secrets.set()` without `await` | TypeScript build confirms type compatibility, but human should confirm no runtime warnings in TUI usage |

## Test Infrastructure Notes

- This is the first test file in the project. Uses Bun's built-in test runner.
- Tests use a temp directory (`.test-tmp/` relative to project root) cleaned up in `beforeEach`/`afterEach`.
- All tests are integration tests against the real filesystem — no mocks needed since `SecretManager` is a thin wrapper around `fs`.
