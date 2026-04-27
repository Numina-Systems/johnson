# GH07: Built-In Web Tools — Test Requirements

Maps each acceptance criterion to automated tests or documented human verification.

---

## Automated Tests

| AC | Criterion | Test Type | Test File | Phase |
|----|-----------|-----------|-----------|-------|
| GH07.AC1.1 | `web_search` calls Exa search API, returns `{ title, url, snippet, score }[]` | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC2.1 | `fetch_page` calls Exa contents API, returns `{ title, url, text, author?, publishDate? }` | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC3.1 | `http_get` does plain fetch, returns `{ status, contentType, body }` (with truncation) | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC4.1 | Missing Exa key returns clear error string for `web_search` and `fetch_page` | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC4.2 | `http_get` unaffected by missing Exa key | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC5.1 | All three tools registered in ToolRegistry | Integration | `src/agent/tools.test.ts` | 2 |
| GH07.AC6.1 | TypeScript stubs generated with correct function signatures | Integration | `src/agent/tools.test.ts` | 2 |
| GH07.AC7.1 | Tool documentation includes all three web tools | Integration | `src/agent/tools.test.ts` | 2 |
| GH07.AC8.1 | Mock fetch responses produce correct structured output | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC8.2 | Missing Exa key produces error for search/fetch, success for http_get | Unit | `src/tools/web.test.ts` | 1 |
| GH07.AC9.1 | Integration: missing key error for search, success for http_get through `createAgentTools` | Integration | `src/agent/tools.test.ts` | 2 |

## Human Verification

| AC | Criterion | Verification Approach | Justification |
|----|-----------|----------------------|---------------|
| None | — | — | All acceptance criteria are automatable via unit and integration tests with mocked fetch. No criteria require manual verification. |

## Notes

- AC8.1 and AC8.2 are meta-criteria about testing itself. They are satisfied by the existence and passing of the unit tests that cover AC1-AC4.
- AC9.1 is a duplicate of AC4 at the integration level (through `createAgentTools` rather than direct handler invocation). Both levels are tested.
- No end-to-end tests against the real Exa API are required by the acceptance criteria. All tests mock `fetch`.
