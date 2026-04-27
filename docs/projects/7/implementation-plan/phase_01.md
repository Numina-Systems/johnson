# GH07: Built-In Web Tools — Phase 1

**Goal:** Create the three web tool handler functions (`web_search`, `fetch_page`, `http_get`) in a new `src/tools/web.ts` module with full test coverage.

**Architecture:** All three tools are pure handler functions that accept parameter objects and return structured results. `web_search` and `fetch_page` call the Exa AI REST API; `http_get` uses plain `fetch()`. A shared `registerWebTools()` function registers all three into a `ToolRegistry`. API key resolution uses `deps.secrets?.get('EXA_API_KEY')` with fallback to `process.env.EXA_API_KEY`.

**Tech Stack:** TypeScript (strict mode), Bun test runner (`bun test`), Exa AI REST API (POST `api.exa.ai/search`, POST `api.exa.ai/contents`)

**Scope:** 2 phases from design (phase 1 of 2)

**Codebase verified:** 2026-04-27

**Design divergence notes:**
- The DAG document (feature-parity-dag.md) says `mode: 'native'` for web tools. The design document (docs/projects/7/design.md) says `mode: 'sandbox'`. The registry does NOT support `mode` yet (#3 Multi-Tool Architecture is unimplemented). All tools are registered with the current 3-argument `register(name, definition, handler)` signature, same as the existing 8 tools. Mode support can be added later when #3 lands.
- `src/tools/` directory does not exist yet and must be created.
- No test files exist in the codebase. This phase creates the first test file. Bun's built-in test runner is configured (`"test": "bun test"` in package.json) but has never been used.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH07.AC1: web_search calls Exa search API
- **GH07.AC1.1 Success:** `web_search` calls Exa search API, returns structured results (array of `{ title, url, snippet, score }`)

### GH07.AC2: fetch_page calls Exa contents API
- **GH07.AC2.1 Success:** `fetch_page` calls Exa contents API, returns extracted text + metadata (`{ title, url, text, author?, publishDate? }`)

### GH07.AC3: http_get does plain fetch
- **GH07.AC3.1 Success:** `http_get` does plain fetch, returns status + body (truncated) as `{ status, contentType, body }`

### GH07.AC4: Missing Exa key handling
- **GH07.AC4.1 Failure:** Missing Exa key produces clear error for `web_search` and `fetch_page`
- **GH07.AC4.2 Success:** `http_get` unaffected by missing Exa key

### GH07.AC8: Unit tests
- **GH07.AC8.1 Test:** Mock fetch responses, verify structured output for each tool
- **GH07.AC8.2 Test:** Missing Exa key, verify error message for search/fetch, success for http_get

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tools/web.ts` with the `registerWebTools` function and all three tool handlers

**Verifies:** GH07.AC1.1, GH07.AC2.1, GH07.AC3.1, GH07.AC4.1, GH07.AC4.2

**Files:**
- Create: `src/tools/web.ts`

**Context files to read before implementing:**
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/agent/tools.ts` — reference for how existing tools are registered (parameter extraction helpers `str()`, `optStr()`, handler signature patterns)
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/runtime/tool-registry.ts` — `ToolRegistry` type and `register()` signature: `register(name: string, definition: ToolDefinition, handler: ToolHandler): void`
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/agent/types.ts` — `AgentDependencies` type (contains `secrets?: SecretManager`)
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/secrets/manager.ts` — `SecretManager` type (has `get(key: string): string | undefined`)
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/model/types.ts` — `ToolDefinition` type: `{ name: string; description: string; input_schema: Record<string, unknown> }`

**Implementation:**

Create `src/tools/web.ts` exporting a single function:

```typescript
function registerWebTools(registry: ToolRegistry, deps: Readonly<AgentDependencies>): void
```

This function registers three tools into the provided registry. The function pattern matches how `createAgentTools()` works in `src/agent/tools.ts` — it receives a registry and deps, and calls `registry.register()` for each tool.

**API key resolution** (shared by `web_search` and `fetch_page`):

```typescript
const exaKey = deps.secrets?.get('EXA_API_KEY') ?? process.env['EXA_API_KEY'];
```

Resolve the key inside the handler (not at registration time) so it picks up runtime changes.

**Tool 1: `web_search`**

- Parameters: `query` (string, required), `num_results` (number, optional, default 5, clamp 1-10), `summary_focus` (string, optional)
- Exa endpoint: `POST https://api.exa.ai/search`
- Request headers: `Content-Type: application/json`, `x-api-key: <exaKey>`
- Request body:
  ```json
  {
    "query": "<query>",
    "numResults": 5,
    "type": "auto",
    "contents": { "text": { "maxCharacters": 1000 } }
  }
  ```
  If `summary_focus` is provided, add `"summary": true` and `"summaryQuery": "<summary_focus>"` to the top-level body.
- If no Exa key: return the string `"Exa API key not configured. Set EXA_API_KEY as a secret or environment variable."`
- If fetch fails or response is not ok: throw an Error with the HTTP status and response text
- Parse response JSON. The Exa response shape is `{ results: Array<{ title: string; url: string; text?: string; score?: number; summary?: string }> }`.
- Map results to return: `Array<{ title, url, snippet, score }>` where `snippet` is `result.summary ?? result.text ?? ''` (prefer summary if available, fall back to text).

**Tool 2: `fetch_page`**

- Parameters: `url` (string, required), `max_chars` (number, optional, default 10000, clamp to 50000 max)
- Exa endpoint: `POST https://api.exa.ai/contents`
- Request body:
  ```json
  {
    "urls": ["<url>"],
    "text": { "maxCharacters": 10000 }
  }
  ```
- If no Exa key: return the string `"Exa API key not configured. Set EXA_API_KEY as a secret or environment variable."`
- Parse response JSON. Shape: `{ results: Array<{ url: string; title?: string; text?: string; author?: string; publishedDate?: string }> }`.
- Return the first result mapped to: `{ title, url, text, author?, publishDate? }`. If no results, throw an Error.

**Tool 3: `http_get`**

- Parameters: `url` (string, required), `max_chars` (number, optional, default 10000, clamp to 50000 max)
- Implementation: plain `fetch(url)` with a 30-second timeout via `AbortSignal.timeout(30_000)`
- Read response body as text, truncate to `max_chars`
- Return: `{ status: response.status, contentType: response.headers.get('content-type') ?? 'unknown', body: <truncated text> }`
- No API key needed. This tool always works.
- If fetch throws (network error, timeout): throw an Error with the message.

**Pattern notes:**
- File header comment: `// pattern: Functional Core — web tool handlers`
- Follow the same parameter extraction pattern as `src/agent/tools.ts`: use local helper functions or inline extraction (the `str()` and `optStr()` helpers in `tools.ts` are not exported, so define similar ones locally or inline the logic).
- All handlers are `async (params: Record<string, unknown>) => Promise<unknown>` matching the `ToolHandler` type.

**Verification:**
Run: `npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(web-tools): add web_search, fetch_page, and http_get tool handlers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create test file for web tools

**Verifies:** GH07.AC8.1, GH07.AC8.2, GH07.AC1.1, GH07.AC2.1, GH07.AC3.1, GH07.AC4.1, GH07.AC4.2

**Files:**
- Create: `src/tools/web.test.ts`

**Context files to read before implementing:**
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/tools/web.ts` — the implementation from Task 1 (read actual function signatures and imports)
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/runtime/tool-registry.ts` — `createToolRegistry()` factory and `ToolRegistry` type
- `/Users/scarndp/dev/johnson/.worktrees/GH07/src/secrets/manager.ts` — `SecretManager` type for mocking

**Test framework:** Bun's built-in test runner. Use `import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'`. No additional test dependencies needed.

**Mocking strategy:**
- Mock `globalThis.fetch` using `mock()` from `bun:test` to intercept HTTP calls. Restore after each test.
- Create a minimal `SecretManager` stub that returns a configurable value for `get('EXA_API_KEY')`.
- Create a `ToolRegistry` using the real `createToolRegistry()` — no need to mock the registry, just call `registerWebTools()` then use `registry.execute()` to invoke handlers.
- Create a minimal `AgentDependencies` stub with only the fields `registerWebTools` needs (just `secrets`). All other fields can be placeholder values that satisfy the type.

**Testing — test cases that must be covered:**

Each test case maps to specific ACs:

1. **GH07.AC1.1 — `web_search` returns structured results:** Call `registry.execute('web_search', { query: 'test' })`. Mock fetch to return a valid Exa search response with 2+ results. Assert the return value is an array of objects each having `{ title, url, snippet, score }`.

2. **GH07.AC2.1 — `fetch_page` returns extracted content:** Call `registry.execute('fetch_page', { url: 'https://example.com' })`. Mock fetch to return a valid Exa contents response. Assert return value has `{ title, url, text }` and optional `author`, `publishDate` fields.

3. **GH07.AC3.1 — `http_get` returns status + body:** Call `registry.execute('http_get', { url: 'https://example.com' })`. Mock fetch to return a plain text response with status 200. Assert return value has `{ status: 200, contentType: 'text/html', body: <text> }`.

4. **GH07.AC3.1 (truncation) — `http_get` truncates body:** Call with `{ url: '...', max_chars: 10 }`. Mock fetch to return a body longer than 10 chars. Assert `body.length <= 10`.

5. **GH07.AC4.1 — `web_search` with missing Exa key:** Create deps with `secrets` stub where `get('EXA_API_KEY')` returns `undefined`. Also ensure `process.env['EXA_API_KEY']` is unset. Call `registry.execute('web_search', { query: 'test' })`. Assert result is the string `"Exa API key not configured. Set EXA_API_KEY as a secret or environment variable."`.

6. **GH07.AC4.1 — `fetch_page` with missing Exa key:** Same setup as above. Call `registry.execute('fetch_page', { url: '...' })`. Assert same error string.

7. **GH07.AC4.2 — `http_get` works without Exa key:** Same "no key" deps. Call `registry.execute('http_get', { url: '...' })`. Mock fetch returns successfully. Assert structured result with status + body (no error).

**Verification:**
Run: `bun test src/tools/web.test.ts`
Expected: All tests pass

**Commit:** `test(web-tools): add unit tests for web_search, fetch_page, http_get`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Run full verification

**Files:** None (verification only)

**Step 1: Type check**
Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run tests**
Run: `bun test`
Expected: All tests pass (these are the only tests in the project)

**Step 3: Verify no regressions**
Run: `bun run build`
Expected: Build succeeds (web.ts is not imported by index.ts yet — that's Phase 2)
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
