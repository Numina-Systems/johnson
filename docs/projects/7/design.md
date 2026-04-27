# #7 — Built-In Web Tools

**Issue:** https://github.com/Numina-Systems/johnson/issues/7
**Wave:** 2 (depends on: #3 registry mode support, #14 secrets)

## Design

### Three sandbox-mode tools

All registered as `mode: 'sandbox'` — web tools are prime candidates for batching and composition inside `execute_code`. The model can search → filter → fetch pages → summarize in one sandbox call.

### `web_search`

Exa AI search. POST to `https://api.exa.ai/search`.

**Parameters:**
- `query` (string, required) — search query
- `num_results` (number, optional, 1-10, default 5) — max results
- `summary_focus` (string, optional) — focus for AI-generated summaries

**Returns:** Array of `{ title, url, snippet, score }`

**Implementation:**
```typescript
const response = await fetch('https://api.exa.ai/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': exaKey },
  body: JSON.stringify({
    query,
    numResults: num_results,
    type: 'neural',
    contents: { text: { maxCharacters: 1000 } },
    ...(summary_focus ? { summary: true, summaryQuery: summary_focus } : {}),
  }),
});
```

### `fetch_page`

Exa content extraction. POST to `https://api.exa.ai/contents`.

**Parameters:**
- `url` (string, required) — URL to extract
- `max_chars` (number, optional, default 10000, max 50000) — truncation limit

**Returns:** `{ title, url, text, author?, publishDate? }`

### `http_get`

Raw HTTP GET via `fetch()`. No Exa dependency.

**Parameters:**
- `url` (string, required) — URL to fetch
- `max_chars` (number, optional, default 10000, max 50000) — body truncation limit

**Returns:** `{ status, contentType, body }`

**Implementation:** Plain `fetch(url)` with 30s timeout. Read body as text, truncate to `max_chars`. No authentication headers — agent must handle auth in sandbox code if needed.

### API Key Resolution

```typescript
const exaKey = deps.secrets?.get('EXA_API_KEY') ?? process.env.EXA_API_KEY;
```

- If Exa key missing: `web_search` and `fetch_page` return error string `"Exa API key not configured. Set EXA_API_KEY as a secret or environment variable."`
- `http_get` always works regardless of Exa key

### Registration

New file `src/tools/web.ts` exporting a function:

```typescript
function registerWebTools(registry: ToolRegistry, deps: AgentDependencies): void
```

Called from `createAgentTools()` in `src/agent/tools.ts`.

All three tools registered with `mode: 'sandbox'`. Available in sandbox as `tools.web_search(...)`, `tools.fetch_page(...)`, `tools.http_get(...)`.

## Files Touched

- `src/tools/web.ts` — new file, three tool definitions + handlers
- `src/agent/tools.ts` — call `registerWebTools(registry, deps)`

## Acceptance Criteria

1. `web_search` calls Exa search API, returns structured results
2. `fetch_page` calls Exa contents API, returns extracted text + metadata
3. `http_get` does plain fetch, returns status + body (truncated)
4. Missing Exa key → clear error for `web_search`/`fetch_page`, `http_get` unaffected
5. All three registered as `mode: 'sandbox'`
6. TypeScript stubs generated so sandbox code can call `tools.web_search(...)` etc.
7. Tool documentation appears in system prompt
8. Test: mock fetch responses, verify structured output for each tool
9. Test: missing Exa key → verify error message for search/fetch, success for http_get
