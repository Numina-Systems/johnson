# Sub-Agent LLM Implementation Plan -- Phase 4: Tests

**Goal:** Add tests verifying the sub-agent factory, all provider variants, the main model fallback, config parsing, and compaction integration.

**Architecture:** Tests use Bun's built-in test runner (`bun test`). The project has no existing test files, so this phase establishes the test directory structure. Provider tests mock `fetch` (for openai-compat, openrouter, ollama, lemonade) and the Anthropic SDK client (for anthropic). The compaction test mocks the `SubAgentLLM` interface directly. Config tests exercise `loadConfig` with temp TOML files.

**Tech Stack:** TypeScript, Bun test runner (`bun:test`), `mock` from `bun:test` for mocking

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase tests:

### GH04.AC1: SubAgentLLM type exported with `complete(prompt, system?) -> Promise<string>`
- **GH04.AC1.1 Success:** Type is importable and usable in test code

### GH04.AC2: All five providers work: anthropic, openai-compat, openrouter, ollama, lemonade
- **GH04.AC2.1 Success:** Anthropic provider extracts text from messages API response
- **GH04.AC2.2 Success:** OpenAI-compat provider extracts `choices[0].message.content`
- **GH04.AC2.3 Success:** OpenRouter provider defaults base URL and extracts response
- **GH04.AC2.4 Success:** Ollama provider extracts `message.content` from `/api/chat`
- **GH04.AC2.5 Success:** Lemonade provider delegates to OpenAI-compat logic

### GH04.AC3: Fallback wraps main model when `[sub_model]` not configured
- **GH04.AC3.1 Success:** `wrapMainModel` calls `model.complete()` with `tools: []` and returns text
- **GH04.AC3.2 Success:** Fallback caps `max_tokens` at 8000

### GH04.AC4: Compaction uses sub-agent instead of main model
- **GH04.AC4.1 Success:** `compactContext` calls `subAgent.complete()` for summarization

### GH04.AC6: Config: `SUB_MODEL_API_KEY` env var overrides TOML
- **GH04.AC6.1 Success:** Env var `SUB_MODEL_API_KEY` takes precedence over TOML `api_key`
- **GH04.AC6.2 Success:** Missing `[sub_model]` section results in `undefined` on `AppConfig`

### GH04.AC7: Test: mock sub-agent returns expected text for each provider variant
- **GH04.AC7.1 Success:** Each provider test verifies the returned string matches the mock response text

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create sub-agent provider tests

**Verifies:** GH04.AC1.1, GH04.AC2.1, GH04.AC2.2, GH04.AC2.3, GH04.AC2.4, GH04.AC2.5, GH04.AC7.1

**Files:**
- Create: `src/model/sub-agent.test.ts`

**Implementation:**

Uses `describe`/`test` from `bun:test` and `mock` for fetch mocking.

Test cases to implement:

1. **Anthropic provider:** Mock the Anthropic SDK's `messages.create` method to return a response with `content: [{ type: 'text', text: 'summary text' }]`. Call `createSubAgent({ provider: 'anthropic', name: 'claude-haiku-4-5-20251001', maxTokens: 8000, apiKey: 'test-key' })` and verify `complete('test prompt', 'test system')` returns `'summary text'`. The Anthropic SDK is instantiated inside `createSubAgent`, so mocking requires either: (a) using `mock.module` from `bun:test` to mock `@anthropic-ai/sdk`, or (b) refactoring the factory to accept an SDK constructor. Option (a) is simpler and matches Bun's test patterns.

2. **OpenAI-compat provider:** Mock global `fetch` to return `{ choices: [{ message: { content: 'compat response' } }] }`. Call `createSubAgent({ provider: 'openai-compat', name: 'gpt-4o-mini', maxTokens: 4000, baseUrl: 'http://localhost:8080/v1', apiKey: 'test-key' })` and verify `complete('hello')` returns `'compat response'`. Also verify the fetch was called with the correct endpoint (`http://localhost:8080/v1/chat/completions`), method POST, and body containing `model`, `max_tokens`, and `messages`.

3. **OpenRouter provider:** Mock global `fetch` same as OpenAI-compat. Call `createSubAgent({ provider: 'openrouter', name: 'meta-llama/llama-3-8b', maxTokens: 4000, baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or-key' })` and verify response text is extracted. Verify fetch URL is `https://openrouter.ai/api/v1/chat/completions`.

4. **Ollama provider:** Mock global `fetch` to return `{ message: { content: 'ollama response' }, done_reason: 'stop' }`. Call `createSubAgent({ provider: 'ollama', name: 'llama3', maxTokens: 4000, baseUrl: 'http://localhost:11434' })` and verify `complete('test')` returns `'ollama response'`. Verify fetch URL is `http://localhost:11434/api/chat` and body includes `stream: false`.

5. **Lemonade provider:** Mock global `fetch` same as OpenAI-compat. Call `createSubAgent({ provider: 'lemonade', name: 'local-model', maxTokens: 4000, baseUrl: 'http://localhost:13305/api/v1', apiKey: 'lemonade' })` and verify it uses the OpenAI-compat endpoint pattern. Verify fetch URL is `http://localhost:13305/api/v1/chat/completions`.

6. **System prompt handling:** For each fetch-based provider, verify that when `system` is provided, the messages array includes a system message as the first element. When `system` is undefined, verify no system message is included.

**Testing approach for fetch mocking:** Use Bun's `mock` to replace `globalThis.fetch` within each test, restoring it in `afterEach`. Structure:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
```

**Testing approach for Anthropic SDK mocking:** Use `mock.module` from `bun:test` to mock `@anthropic-ai/sdk`. The mock should return a constructor that provides a `messages.create` method:

```typescript
mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(() => Promise.resolve({
        content: [{ type: 'text', text: 'summary text' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    };
  },
}));
```

**Verification:**
Run: `bun test src/model/sub-agent.test.ts`
Expected: All tests pass

**Commit:** `test(model): add sub-agent provider tests`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create config loader tests for `[sub_model]` parsing

**Verifies:** GH04.AC6.1, GH04.AC6.2

**Files:**
- Create: `src/config/loader.test.ts`

**Implementation:**

Test cases:

1. **No `[sub_model]` section:** Write a minimal TOML config (just `[model]` with required fields) to a temp file. Call `loadConfig(tempPath)`. Verify `config.subModel` is `undefined`.

2. **Full `[sub_model]` section:** Write TOML with:
   ```toml
   [sub_model]
   provider = "anthropic"
   name = "claude-haiku-4-5-20251001"
   max_tokens = 4000
   api_key = "toml-key"
   ```
   Call `loadConfig(tempPath)`. Verify `config.subModel` matches expected values.

3. **Env var override:** Set `process.env['SUB_MODEL_API_KEY'] = 'env-key'` before calling `loadConfig`. Write TOML with `api_key = "toml-key"` in `[sub_model]`. Verify `config.subModel.apiKey === 'env-key'`. Clean up env var in afterEach.

4. **Provider-specific defaults:** Write TOML with `provider = "openrouter"` in `[sub_model]` without `base_url`. Verify `config.subModel.baseUrl` is `'https://openrouter.ai/api/v1'` (from `resolveBaseUrl`).

**Testing approach for temp files:** Use Bun's `Bun.write()` to create temp TOML files, and `fs.unlinkSync` for cleanup. Use `os.tmpdir()` for the temp directory:

```typescript
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

const tempPath = join(tmpdir(), `test-config-${Date.now()}.toml`);
```

Clean up env vars in `afterEach` to avoid test pollution:

```typescript
afterEach(() => {
  delete process.env['SUB_MODEL_API_KEY'];
  delete process.env['SUB_MODEL_PROVIDER'];
  delete process.env['SUB_MODEL_NAME'];
  delete process.env['SUB_MODEL_BASE_URL'];
});
```

**Verification:**
Run: `bun test src/config/loader.test.ts`
Expected: All tests pass

**Commit:** `test(config): add loader tests for [sub_model] parsing`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create `wrapMainModel` fallback and compaction integration tests

**Verifies:** GH04.AC3.1, GH04.AC3.2, GH04.AC4.1

**Files:**
- Modify: `src/model/sub-agent.test.ts` (add describe block for wrapMainModel)
- Create: `src/agent/compaction.test.ts`

**Implementation:**

**wrapMainModel tests** (add to `src/model/sub-agent.test.ts`):

1. **Extracts text from content blocks:** Create a mock `ModelProvider` whose `complete()` returns `{ content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }`. Call `wrapMainModel(mockModel, 'test-model', 16000)`. Verify `complete('prompt')` returns `'hello world'`.

2. **Passes tools: [] to model:** Verify the mock's `complete` was called with `tools: []`.

3. **Caps maxTokens at 8000:** Call `wrapMainModel(mockModel, 'test-model', 16384)`. Verify the mock's `complete` was called with `max_tokens: 8000`.

4. **Passes system prompt through:** Call `complete('prompt', 'be helpful')`. Verify mock's `complete` was called with `system: 'be helpful'`.

**Compaction integration test** (`src/agent/compaction.test.ts`):

1. **`compactContext` uses sub-agent for summarization:** Create a mock `SubAgentLLM` that returns `'Earlier topics: weather, coding'`. Create a mock `Store` with enough context documents to trigger summarization (more than `RECENT_NOTES_COUNT = 3`):
   - Mock `store.docUpsert` to no-op
   - Mock `store.docList` to return 5 context documents with `rkey` starting with `context/`
   Verify that after calling `compactContext(messages, { store, subAgent })`:
   - The sub-agent's `complete` was called
   - The returned messages contain the summary text
   - The system prompt passed to `complete` contains 'context summarizer'

2. **`compactContext` with few context docs skips summarization:** Set up only 2 context documents (fewer than `RECENT_NOTES_COUNT`). Verify sub-agent's `complete` was NOT called (no older docs to summarize).

**Mock Store pattern:** The `Store` type is defined in `src/store/store.ts`. For tests, create a partial mock implementing only `docUpsert` and `docList`:

```typescript
const mockStore = {
  docUpsert: mock(() => {}),
  docList: mock(() => ({
    documents: [
      { rkey: 'context/2025-01-01T00-00-00', content: 'conversation 1' },
      { rkey: 'context/2025-01-02T00-00-00', content: 'conversation 2' },
      { rkey: 'context/2025-01-03T00-00-00', content: 'conversation 3' },
      { rkey: 'context/2025-01-04T00-00-00', content: 'conversation 4' },
      { rkey: 'context/2025-01-05T00-00-00', content: 'conversation 5' },
    ],
    total: 5,
  })),
} as unknown as Store;
```

**Verification:**
Run: `bun test`
Expected: All tests pass across all test files

**Commit:** `test: add wrapMainModel and compaction integration tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
