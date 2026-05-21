# Typed Error Hierarchy Design

## Summary

This design formalises error handling across the agent's model, store, and config layers by introducing a consistent typed error hierarchy. Currently, raw exceptions and SDK-specific errors can escape module boundaries unchecked, making it impossible for callers — the agent loop, the TUI, Discord — to reason about what went wrong or whether to retry. The solution is three new error classes (`StoreError`, `ConfigError`, `ExecutorErrorKind`) that follow the discriminated-kind pattern already established by the existing `ModelError`, plus a `withRetry` middleware wrapper that centralises retry logic and removes the ad-hoc retry loops currently scattered across individual model providers.

The implementation is phased to avoid destabilising working code: error types are defined first (Phase 1), then providers are updated to classify exceptions correctly (Phase 2), then retry middleware replaces internal loops (Phase 3), then events and UI propagation are wired up (Phases 4–6). Each phase has independently verifiable acceptance criteria. The end result is that every failure in the model, store, and config layers carries enough structured information for callers to display meaningful diagnostics, apply appropriate retry behaviour, and fail gracefully without surfacing raw stack traces.

## Definition of Done

1. **Every model provider** (`anthropic.ts`, `ollama.ts`, `openrouter.ts`, `sub-agent.ts`) wraps SDK exceptions in `ModelError` using the existing `classifyHttpError`/`classifyFetchError` helpers — no raw exceptions escape the model layer.
2. **Executor** gains a typed `ExecutorErrorKind` on `ExecutionResult` (`timeout`, `crash`, `parse`, `size_limit`, `unknown`) without changing its never-throws contract.
3. **New error classes** — `StoreError`, `ConfigError` — exist as flat, independent classes following `ModelError`'s discriminated-kind pattern.
4. **Store errors** are caught at module boundaries (agent loop, scheduler, archivist) and wrapped as `StoreError`, not inside the store itself.
5. **Config errors** are typed at validation time (`ConfigError` with kinds like `missing_field`, `invalid_value`, `parse_failed`).
6. **Agent loop** auto-retries retryable `ModelError` kinds with exponential backoff (up to N attempts), showing progress status to callers via the event system.
7. **TUI** displays typed error context (error kind, retryability, retry progress) instead of just `error.message`.
8. **Discord** displays typed error context with the same information, adapted for message format.
9. **All existing tests pass**, new tests cover error classification at each boundary.

## Acceptance Criteria

### typed-errors.AC1: Error Type Definitions
- **typed-errors.AC1.1 Success:** `StoreError` constructed with each kind (`query_failed`, `constraint_violation`, `connection_lost`, `corrupt`) has correct `kind` and `retryable === false`
- **typed-errors.AC1.2 Success:** `StoreError.from(err, context)` wraps unknown error, sets `cause` to original, includes context in message
- **typed-errors.AC1.3 Success:** `StoreError.from(err, context)` returns existing `StoreError` unchanged when given a `StoreError`
- **typed-errors.AC1.4 Success:** `ConfigError` constructed with each kind (`parse_failed`, `missing_field`, `invalid_value`) has correct `kind` and `cause`
- **typed-errors.AC1.5 Success:** `ExecutionResult` with `errorKind: 'timeout'` compiles and is distinguishable from `errorKind: 'crash'`

### typed-errors.AC2: Provider Error Classification
- **typed-errors.AC2.1 Success:** Anthropic provider returns `ModelError` with `kind: 'rate_limit'` on HTTP 429
- **typed-errors.AC2.2 Success:** Anthropic provider returns `ModelError` with `kind: 'auth'` on HTTP 401/403
- **typed-errors.AC2.3 Success:** Anthropic provider returns `ModelError` with `kind: 'timeout'` on AbortError
- **typed-errors.AC2.4 Success:** Anthropic provider returns `ModelError` with `kind: 'network'` on ECONNREFUSED
- **typed-errors.AC2.5 Success:** Ollama provider returns `ModelError` with `kind: 'model_loading'` when model is not loaded
- **typed-errors.AC2.6 Success:** OpenRouter provider returns `ModelError` with `kind: 'server_error'` on HTTP 500/502/503
- **typed-errors.AC2.7 Success:** Sub-agent propagates `ModelError` from underlying provider (not wrapped in generic `Error`)
- **typed-errors.AC2.8 Failure:** No provider throws a raw `Error` or SDK-specific exception — all are classified as `ModelError`

### typed-errors.AC3: Retry Middleware
- **typed-errors.AC3.1 Success:** `withRetry` retries a retryable `ModelError` up to `maxRetries` times
- **typed-errors.AC3.2 Success:** `withRetry` throws immediately on non-retryable `ModelError` (no retry attempts)
- **typed-errors.AC3.3 Success:** Delay between retries increases exponentially with jitter
- **typed-errors.AC3.4 Success:** `onRetry` callback fires before each retry with correct error, attempt number, and delay
- **typed-errors.AC3.5 Success:** After retry exhaustion, the final `ModelError` is thrown (not a wrapper)
- **typed-errors.AC3.6 Success:** Provider that succeeds after N failures returns the successful response
- **typed-errors.AC3.7 Edge:** Non-`ModelError` exceptions pass through without retry

### typed-errors.AC4: Event Integration
- **typed-errors.AC4.1 Success:** `model_retry` event fires during retry with `kind`, `attempt`, `maxRetries`, `delayMs` in data
- **typed-errors.AC4.2 Success:** `model_error` event fires when non-retryable error occurs, with `kind`, `message`, `retryable` in data
- **typed-errors.AC4.3 Success:** `model_error` event fires when retries are exhausted
- **typed-errors.AC4.4 Success:** Both main model and sub-agent provider are wrapped with `withRetry` in `main()`

### typed-errors.AC5: Store & Config Error Boundaries
- **typed-errors.AC5.1 Success:** SQLite exception in agent loop is caught and thrown as `StoreError` with `cause` set
- **typed-errors.AC5.2 Success:** SQLite exception in scheduler is caught, logged as `StoreError`, and sets `lastRun.success = false`
- **typed-errors.AC5.3 Success:** SQLite exception in archivist pipeline stage fails the stage gracefully (doesn't crash the pipeline)
- **typed-errors.AC5.4 Success:** Invalid TOML in config file throws `ConfigError` with `kind: 'parse_failed'`
- **typed-errors.AC5.5 Success:** Missing required config field throws `ConfigError` with `kind: 'missing_field'`
- **typed-errors.AC5.6 Success:** Invalid config value throws `ConfigError` with `kind: 'invalid_value'`
- **typed-errors.AC5.7 Success:** `main()` catches `ConfigError` and exits with clear diagnostic (not a stack trace)

### typed-errors.AC6: UI Error Propagation
- **typed-errors.AC6.1 Success:** TUI displays `ModelError` kind and message (e.g., `[rate_limit] Rate limited (429)`)
- **typed-errors.AC6.2 Success:** TUI displays retry progress in status bar during `model_retry` events
- **typed-errors.AC6.3 Success:** TUI displays `StoreError` with context (e.g., `[store] docGet: query failed`)
- **typed-errors.AC6.4 Success:** Discord displays formatted `ModelError` message with retry count
- **typed-errors.AC6.5 Success:** Discord displays formatted `StoreError` message
- **typed-errors.AC6.6 Success:** Executor populates `errorKind` on all failure paths (timeout, crash, parse, size limit)
- **typed-errors.AC6.7 Failure:** Generic `Error` still displays a message (no silent failures)

## Glossary

- **Discriminated-kind pattern**: A TypeScript pattern where an error (or union type) carries a `kind` literal field that narrows the type in a `switch` or `if` block. Used here so callers can branch on `error.kind` without `instanceof` on subtypes.
- **ModelError**: The existing typed error class in `src/model/types.ts`. Represents failures from LLM API calls. Sets the pattern that `StoreError` and `ConfigError` follow.
- **StoreError**: New typed error wrapping SQLite failures. Caught at module boundaries (agent loop, scheduler, archivist), not inside the store itself.
- **ConfigError**: New typed error wrapping config validation failures (bad TOML, missing fields, invalid values). Always fatal — no retry concept applies.
- **ExecutorErrorKind**: New type union added to `ExecutionResult`. Classifies sandbox subprocess failures without changing the executor's never-throws contract.
- **withRetry**: New `ModelProvider` wrapper in `src/model/retry.ts`. Intercepts `complete()` calls and retries on retryable `ModelError` kinds using exponential backoff with jitter. A Functional Core module.
- **Exponential backoff with jitter**: A retry delay strategy where each wait doubles from the previous, plus a random offset. The jitter prevents multiple clients from retrying simultaneously after a shared rate limit ("thundering herd").
- **Functional Core / Imperative Shell (FCIS)**: Architectural pattern enforced in this codebase. Pure functions with no side effects (FC) are separated from I/O and process-spawning code (IS). `withRetry` and error classes are FC; event wiring and provider construction in `main()` are IS.
- **classifyHttpError / classifyFetchError**: Existing helpers in `src/model/types.ts` that map HTTP status codes and fetch exceptions to `ModelError` kinds. Reused by all providers — no new helpers needed.
- **AgentEventKind**: The discriminated union of event names the agent emits (e.g., `llm_start`, `tool_done`). Extended here with `model_retry` and `model_error`.
- **Thundering herd**: The failure mode where many clients retry simultaneously after a shared resource (like a rate-limited API) becomes briefly unavailable, immediately overwhelming it again. Jitter in backoff delays prevents this.
- **Error.cause**: ES2022 standard property for chaining exceptions. Used by `StoreError` and `ConfigError` to preserve the original low-level exception alongside the typed wrapper.
- **SDK-internal retry**: Some API client libraries (e.g., the Anthropic SDK) have built-in retry logic. This design disables it so `withRetry` is the single source of retry behaviour and can emit events.
- **ExecutionResult**: The return type of the Deno sandbox executor. Always returned (never throws) — errors are represented as fields on the result object. `ExecutorErrorKind` extends this with structured failure classification.
- **Sub-agent**: A lightweight single-shot LLM call used for utility tasks (compaction, session titling, summarisation) without consuming main-model tool rounds. Gets its own `withRetry` wrapper with a smaller retry budget.

## Architecture

Flat, independent error classes per domain — each following the discriminated-kind pattern established by `ModelError`. No wrapper type or nesting. Callers use `instanceof` checks.

### Error Classes

**ModelError** (exists, `src/model/types.ts`) — unchanged. 9 `ModelErrorKind` variants, `retryable` property, `classifyHttpError()`/`classifyFetchError()` classification helpers.

**StoreError** (new, `src/store/errors.ts`) — wraps SQLite exceptions at module boundaries. Kinds: `query_failed`, `constraint_violation`, `connection_lost`, `corrupt`. Static `StoreError.from(err, context)` factory wraps unknown errors. `retryable` is always `false` (SQLite errors are unrecoverable at application level). Uses `Error.cause` to chain the original exception.

**ConfigError** (new, `src/config/errors.ts`) — wraps config validation failures. Kinds: `parse_failed` (invalid TOML), `missing_field`, `invalid_value`. Always fatal — no `retryable` property. Uses `Error.cause`.

**ExecutorErrorKind** (new, `src/runtime/types.ts`) — a type union added to `ExecutionResult`, not a class. Kinds: `timeout`, `crash`, `parse`, `size_limit`, `unknown`. Executor keeps its never-throws contract. The existing `timedOut` boolean becomes redundant (superseded by `errorKind: 'timeout'`) but remains during migration.

### Error Classification Contracts

Each error class exposes:

```typescript
interface TypedError {
  readonly kind: string;        // discriminant (literal union)
  readonly retryable: boolean;  // caller retry hint
  readonly cause?: unknown;     // original exception (ES2022)
}
```

StoreError and ConfigError follow this shape. ModelError already does.

### Provider Classification

All model providers classify SDK exceptions into `ModelError` before throwing. Classification uses the existing `classifyHttpError(status, body)` and `classifyFetchError(err)` helpers — no new helpers needed.

- `src/model/anthropic.ts` — wraps Anthropic SDK call in try-catch, classifies via helpers, disables SDK-internal retry
- `src/model/ollama.ts` — removes `isRetryable()` string-matching heuristic and manual retry loop, classifies via helpers
- `src/model/openrouter.ts` — wraps SDK call, classifies via helpers
- `src/model/openai-compat.ts` — classification stays as-is, internal retry loop removed (moved to middleware)
- `src/model/sub-agent.ts` — stops wrapping exceptions as generic `Error`, lets `ModelError` propagate from underlying provider

### Retry Middleware

`withRetry(provider, options): ModelProvider` in `src/model/retry.ts`. A Functional Core module that wraps any `ModelProvider`, intercepting `complete()` calls. Catches `ModelError` where `retryable === true`, retries with exponential backoff and jitter.

```typescript
type RetryOptions = {
  readonly maxRetries: number;       // default 3
  readonly baseDelayMs: number;      // default 2000
  readonly maxDelayMs: number;       // default 30000
  readonly onRetry?: (error: ModelError, attempt: number, delayMs: number) => void;
};
```

Delay formula: `min(baseDelayMs * 2^attempt + random(0, baseDelayMs/2), maxDelayMs)`. Jitter prevents thundering herd on shared rate limits.

Applied in `src/index.ts`:
- Main model: `withRetry(rawProvider, { maxRetries: 3, onRetry })` 
- Sub-agent provider: `withRetry(subProvider, { maxRetries: 2, onRetry })`

### Event Integration

Two new event kinds added to `AgentEventKind` in `src/agent/types.ts`:

- `'model_retry'` — emitted via `onRetry` callback before each retry sleep. Data: `{ kind, attempt, maxRetries, delayMs }`
- `'model_error'` — emitted by agent loop catch block when a non-retryable error occurs or retries are exhausted. Data: `{ kind, message, retryable }`

`AgentEvent.data` remains `Record<string, unknown>`. Typing the event data union is a separate concern.

The `onRetry` callback is wired in `main()` to emit `model_retry` events through the agent's event system.

### Store Error Boundaries

StoreError wrapping at three module boundaries:

1. **Agent loop** (`src/agent/agent.ts`) — wraps `store.docGet('self')` and other store calls in the chat path. On `StoreError`, emits `model_error` event and throws.
2. **Scheduler** (`src/scheduler/scheduler.ts`) — wraps store calls in task persistence. On `StoreError`, logs with context and sets `lastRun.success = false`.
3. **Archivist pipeline** (`src/archivist/pipeline.ts`) — wraps store calls in each stage. On `StoreError`, the stage fails gracefully (existing degradation pattern).

The store itself (`src/store/store.ts`) is unchanged — no internal try-catch added.

### Config Error Boundaries

`loadConfig()` in `src/config/loader.ts`:
- Wraps `TOML.parse()` → `ConfigError('parse_failed', ...)`
- Validation checks throw `ConfigError('missing_field', ...)` or `ConfigError('invalid_value', ...)`
- `main()` catches `ConfigError`, prints a diagnostic message, and exits

### UI Propagation

**TUI** (`src/tui/screens/ChatScreen.tsx`):
- Catch block uses `instanceof` checks for `ModelError`, `StoreError`
- `ModelError` → displays kind, message, and retry exhaustion status (e.g., `[rate_limit] Rate limited (429) — retries exhausted`)
- `StoreError` → displays `[store] context: message`
- Generic `Error` → falls back to current behaviour
- Subscribes to `model_retry` events for status bar updates: `"Rate limited — retrying in 5s (attempt 2/3)..."`

**Discord** (`src/discord/bot.ts`):
- Same `instanceof` checks, formatted for Discord messages
- `ModelError` → `⚠️ Rate limited — retried 3 times, still failing. Try again later.`
- `StoreError` → `❌ Database error: context`
- Generic → current behaviour (`❌ Error: ...`)
- No interactive retry UI (Discord has no interactive button affordance in this bot)

## Existing Patterns

Investigation found the following patterns this design follows:

**Discriminated kind pattern** — `ModelError` in `src/model/types.ts` uses a literal `kind` union with `retryable` property. `StoreError` and `ConfigError` follow the same shape.

**Classification helpers** — `classifyHttpError()` and `classifyFetchError()` in `src/model/types.ts` convert raw exceptions to typed errors. Providers will use these directly.

**Functional Core / Imperative Shell** — `withRetry` is a pure wrapper (FC). Event wiring and provider construction happen in `main()` (IS). Error classes and classification helpers are FC. Boundary wrapping is IS.

**Event emission** — `emit()` helper in `src/agent/agent.ts` wraps `onEvent` callbacks in try-catch. New events follow the same pattern and naming convention.

**Result-based executor** — `ExecutionResult` in `src/runtime/executor.ts` returns errors as values (never throws). `ExecutorErrorKind` extends this pattern without changing the contract.

**No divergence from existing patterns.** This design extends what already works.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Error Types
**Goal:** Define new error classes and executor error kind type

**Components:**
- `StoreError` class in `src/store/errors.ts` — kinds, static `from()` factory, `Error.cause` chaining
- `ConfigError` class in `src/config/errors.ts` — kinds, `Error.cause` chaining
- `ExecutorErrorKind` type in `src/runtime/types.ts` — added to `ExecutionResult`

**Dependencies:** None (first phase)

**Done when:** New types compile, unit tests verify `StoreError.from()` wraps unknown errors correctly, `ConfigError` constructors produce correct kinds, `ExecutorErrorKind` is assignable on `ExecutionResult`. Covers typed-errors.AC1.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Provider Error Classification
**Goal:** All model providers classify SDK exceptions as `ModelError`

**Components:**
- `src/model/anthropic.ts` — try-catch around SDK call, classify via helpers, disable SDK retry
- `src/model/ollama.ts` — remove `isRetryable()` heuristic and manual retry loop, classify via helpers
- `src/model/openrouter.ts` — try-catch around SDK call, classify via helpers
- `src/model/sub-agent.ts` — remove generic `Error` wrapping, let `ModelError` propagate

**Dependencies:** Phase 1 (error types exist)

**Done when:** Each provider throws `ModelError` with correct kind for rate limit, auth, timeout, network, server error, and model loading scenarios. No raw exceptions escape. Tests mock SDK responses to verify classification. Covers typed-errors.AC2.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Retry Middleware
**Goal:** Centralised retry logic via `withRetry` wrapper, removing provider-internal retries

**Components:**
- `src/model/retry.ts` — `withRetry(provider, options): ModelProvider` with exponential backoff + jitter
- `src/model/openai-compat.ts` — remove internal retry loop (classification stays)
- `src/model/ollama.ts` — confirm internal retry already removed in Phase 2

**Dependencies:** Phase 2 (providers throw typed `ModelError`)

**Done when:** `withRetry` retries retryable errors up to N times with backoff, throws immediately on non-retryable errors, fires `onRetry` callback before each retry, respects max delay. Tests verify retry count, delay progression, callback invocation, and non-retryable passthrough. Covers typed-errors.AC3.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Event Integration & Wiring
**Goal:** New error events and retry wiring in `main()`

**Components:**
- `src/agent/types.ts` — add `'model_retry'` and `'model_error'` to `AgentEventKind`
- `src/index.ts` — wire `withRetry` around main model and sub-agent providers, connect `onRetry` callback to agent event system
- `src/agent/agent.ts` — emit `model_error` in catch block before re-throwing

**Dependencies:** Phase 3 (retry middleware exists)

**Done when:** `model_retry` events fire during retries with correct data shape, `model_error` events fire on non-retryable errors and retry exhaustion. Both main model and sub-agent provider are wrapped with retry. Covers typed-errors.AC4.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Store & Config Error Boundaries
**Goal:** Typed error wrapping at module boundaries and config validation

**Components:**
- `src/agent/agent.ts` — try-catch around store calls, wrap as `StoreError`
- `src/scheduler/scheduler.ts` — try-catch around store calls, wrap as `StoreError`
- `src/archivist/pipeline.ts` — try-catch around store calls, wrap as `StoreError`
- `src/config/loader.ts` — wrap `TOML.parse()` and validation in `ConfigError`
- `src/index.ts` — catch `ConfigError` in `main()`, print diagnostic, exit

**Dependencies:** Phase 1 (error types exist)

**Done when:** Store errors at boundaries produce `StoreError` with correct kind and cause. Config validation produces `ConfigError` with correct kind. `main()` catches `ConfigError` and exits with clear message. Tests verify boundary wrapping and config error scenarios. Covers typed-errors.AC5.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: UI Error Propagation
**Goal:** TUI and Discord display typed error context and retry progress

**Components:**
- `src/tui/screens/ChatScreen.tsx` — `instanceof` checks in catch block, `model_retry` event listener for status bar
- `src/discord/bot.ts` — `instanceof` checks in catch block, formatted error messages
- `src/runtime/executor.ts` — populate `errorKind` on `ExecutionResult` at each failure point

**Dependencies:** Phase 4 (events exist), Phase 5 (store/config errors exist)

**Done when:** TUI shows typed error messages with kind and retry progress. Discord shows formatted error messages. Executor populates `errorKind` on all failure paths. Covers typed-errors.AC6.
<!-- END_PHASE_6 -->

## Additional Considerations

**Backwards compatibility:** The `timedOut` field on `ExecutionResult` becomes redundant but is kept during migration. Callers should prefer `errorKind === 'timeout'`. Once all callers are migrated, `timedOut` can be removed.

**openai-compat retry removal:** When the internal retry loop is removed from `openai-compat.ts`, existing behaviour is preserved by the `withRetry` wrapper applied in `main()`. The default retry parameters match the current constants (`MAX_RETRIES=3`, `BASE_DELAY_MS=2000`).

**Sub-agent retry budget:** Sub-agent gets 2 retries (vs 3 for main model). Sub-agent tasks (compaction, titling, archivist) are less critical — failing faster is preferable to blocking the main conversation.
