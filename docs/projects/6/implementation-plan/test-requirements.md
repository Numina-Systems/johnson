# GH06: Outbound Notification Tool — Test Requirements

## Automated Tests

All acceptance criteria for GH06 can be verified via automated unit tests. No integration or e2e tests required — the tool is a pure function (params + deps in, string out) with `fetch` as the only external call, easily mocked.

| Criterion | Test Description | Type | File |
|-----------|-----------------|------|------|
| GH06.AC1.1 | Verify `fetch` is called with the webhook URL from secrets | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC2.1 | Missing secret returns error string (not thrown error) | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC3.1 | Without title: request body is `{ content }` | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC4.1 | With title: request body is `{ embeds: [{ title, description }] }` | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC5.1 | Content over 2000 chars is truncated in both plain and embed modes | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC6.1 | Tool is registered in registry (verified implicitly — `registry.execute('notify_discord', ...)` succeeds) | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC7.1 | Mock fetch, verify plain message payload structure | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC8.1 | Mock fetch, verify embed payload structure when title provided | Unit | `src/tools/__tests__/notify.test.ts` |
| GH06.AC9.1 | Missing secret returns error string, fetch not called | Unit | `src/tools/__tests__/notify.test.ts` |

## Human Verification

| Criterion | Verification Approach | Justification |
|-----------|----------------------|---------------|
| GH06.AC6.1 (mode: 'both') | Inspect code for `// TODO(GH03)` comment; verify mode is updated when #3 lands | The `mode: 'both'` aspect cannot be tested until #3 implements mode support in `ToolRegistry`. The sandbox registration is implicitly tested by `registry.execute()` succeeding. |

## Test Execution

```bash
bun test
```

All tests run via Bun's built-in test runner. No additional configuration needed.
