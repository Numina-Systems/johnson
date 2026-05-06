# Reflexive Recall — Test Requirements

## Automated Tests

### AC Group: AC1 — Decomposition

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC1.1 | Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"] | unit | `src/recall/decompose.test.ts` | `parseDecompositionResponse` returns correct queries/entities from valid JSON; `decomposeMessage` with mocked SubAgentLLM returns expected decomposition and passes the user message through to the prompt |
| reflexive-recall.AC1.2 | Multi-topic message produces 2-4 distinct queries covering each topic | unit | `src/recall/decompose.test.ts` | `parseDecompositionResponse` preserves up to 4 queries from valid JSON with multiple topics; caps at 4 if more are provided |
| reflexive-recall.AC1.3 | Single-word message produces one query containing that word | unit | `src/recall/decompose.test.ts` | `parseDecompositionResponse` returns a single-element queries array when input JSON contains one query |
| reflexive-recall.AC1.4 | Message with no proper nouns produces empty entities array | unit | `src/recall/decompose.test.ts` | `parseDecompositionResponse` returns `entities: []` when input JSON has an empty entities array |

### AC Group: AC2 — Retrieval

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC2.1 | Each semantic query returns up to 5 results via hybridSearch | integration | `src/recall/retrieve.test.ts` | `retrieveContext` with mocked deps calls hybridSearch per query with limit 5; result set size respects the per-query cap |
| reflexive-recall.AC2.2 | Named entities return results via direct FTS lookup (limit 3 per entity) | integration | `src/recall/retrieve.test.ts` | `retrieveContext` calls `store.docSearch` for each entity with limit 3; entity-sourced fragments have `source: 'entity'` |
| reflexive-recall.AC2.3 | Results from multiple queries are merged and ranked by RRF score | unit | `src/recall/retrieve.test.ts` | `deduplicateFragments` keeps highest-scored duplicate; merged output sorted descending by score; RRF scores from entity lookups converted via `1 / (60 + rank)` |

### AC Group: AC3 — Prefix Filtering

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC3.1 | knowledge:\*, skill:\*, archive:\* documents appear in results | unit | `src/recall/retrieve.test.ts` | `filterByPrefix` passes through fragments with rkeys `knowledge:foo`, `skill:bar`, `archive:2024-01-01` |
| reflexive-recall.AC3.2 | self and operator documents are excluded from results | unit | `src/recall/retrieve.test.ts` | `filterByPrefix` excludes fragments with rkeys `self` and `operator` |
| reflexive-recall.AC3.3 | task:\* documents are excluded | unit | `src/recall/retrieve.test.ts` | `filterByPrefix` excludes fragments with rkey `task:research`; also verifies `customtool:*` excluded |

### AC Group: AC4 — Token Budget

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC4.1 | Total recalled content is <= 1500 tokens (configurable) | unit | `src/recall/retrieve.test.ts` | `trimToTokenBudget` with budget 1500 includes only enough fragments to stay within budget; `totalTokens` in result <= budget |
| reflexive-recall.AC4.2 | If a single fragment exceeds remaining budget, it is truncated not dropped | unit | `src/recall/retrieve.test.ts` | `trimToTokenBudget` truncates a large fragment's content via character slicing rather than omitting it; truncated fragment is present in output with shortened content |
| reflexive-recall.AC4.3 | Zero matching documents produces no system prompt section | unit | `src/agent/context.test.ts` | `buildSystemPrompt` with empty `recalledContext` array (or undefined) produces output that does not contain `## Recalled Context` |

### AC Group: AC5 — Fallback Cascade

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC5.1 | SubAgentLLM failure falls back to raw message as single hybridSearch query | unit + integration | `src/recall/decompose.test.ts`, `src/recall/index.test.ts` | `decomposeMessage` with throwing mock SubAgentLLM returns `fallbackDecomposition(message)`; `performRecall` with `subAgent: undefined` still returns results using raw message as query |
| reflexive-recall.AC5.2 | Malformed JSON from SubAgentLLM triggers same fallback | unit + integration | `src/recall/decompose.test.ts`, `src/recall/index.test.ts` | `parseDecompositionResponse` returns empty queries/entities for non-JSON input; `decomposeMessage` falls back to `fallbackDecomposition`; `performRecall` end-to-end still returns results |
| reflexive-recall.AC5.3 | Embedding failure degrades hybridSearch to FTS-only | integration | `src/recall/index.test.ts` | `performRecall` with an embedding provider that throws on `embed()` still returns FTS-sourced results (relies on existing hybridSearch fallback) |
| reflexive-recall.AC5.4 | Both SubAgentLLM and embeddings down still returns FTS results | integration | `src/recall/index.test.ts` | `performRecall` with `subAgent: undefined` AND throwing embedding provider still returns FTS results on the raw message |

### AC Group: AC6 — Guard Conditions

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC6.1 | recall_enabled=false skips recall entirely (default behavior) | integration | `src/agent/agent.test.ts` | Agent with `recallEnabled: false` in config emits no `recall_done` event; agent with `recallEnabled: true` does emit `recall_done` |
| reflexive-recall.AC6.2 | Messages < 10 chars skip recall | unit | `src/recall/index.test.ts` | `performRecall("hi", deps)` returns null |
| reflexive-recall.AC6.3 | Empty document store skips recall (returns null) | unit | `src/recall/index.test.ts` | `performRecall` with store containing zero documents returns null |
| reflexive-recall.AC6.4 | Missing embedding provider skips recall | unit | `src/recall/index.test.ts` | `performRecall` with `embedding: undefined` returns null |

### AC Group: AC7 — Prompt Injection

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC7.1 | Recalled context section appears after self doc, before Available Skills | unit | `src/agent/context.test.ts` | `indexOf('Recalled Context') > indexOf('Your Memory')` and `indexOf('Recalled Context') < indexOf('Available Skills')` in the output of `buildSystemPrompt` |
| reflexive-recall.AC7.2 | Each fragment rendered with rkey header and content, no score metadata | unit | `src/agent/context.test.ts` | Output contains `### knowledge:caldav\nCalDAV protocol notes` per fragment; output does not contain `score` or numeric metadata |
| reflexive-recall.AC7.3 | Absent recalledContext produces no section in prompt | unit | `src/agent/context.test.ts` | `buildSystemPrompt` called without `recalledContext` (undefined) and with empty array both produce output lacking `## Recalled Context` |

### AC Group: AC8 — Lifecycle Event

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC8.1 | recall_done event emitted with elapsed ms and fragment count | integration | `src/agent/agent.test.ts` | Agent with `recallEnabled: true` and seeded store emits `recall_done` event; event payload contains `elapsed` (number >= 0), `fragmentCount` (number >= 0), `totalTokens` (number >= 0) |
| reflexive-recall.AC8.2 | Event fires even when recall returns zero fragments | integration | `src/agent/agent.test.ts` | Agent with `recallEnabled: true` but empty store emits `recall_done` with `fragmentCount: 0` |

### AC Group: AC9 — Compaction Ordering

| AC ID | Criterion | Test Type | Test File | What Test Verifies |
|-------|-----------|-----------|-----------|-------------------|
| reflexive-recall.AC9.1 | Recall runs after compaction check completes | integration | `src/agent/agent.test.ts` | When compaction triggers, `recall_done` event appears after compaction activity and before `llm_start` in the collected event sequence |
| reflexive-recall.AC9.2 | Recalled context tokens are not included in compaction threshold estimate | integration | `src/agent/agent.test.ts` | With `recallEnabled: true` and identical history, compaction decision is the same regardless of whether recall injects content (recalled context lives in system prompt, not history) |

## Human Verification

| AC ID | Criterion | Why Not Automated | Verification Approach |
|-------|-----------|-------------------|----------------------|
| reflexive-recall.AC1.1 | Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"] | The unit test verifies parsing of known-good JSON, but the actual SubAgentLLM output for a given message is non-deterministic. Whether the model produces *semantically appropriate* queries requires human judgement. | Run the agent with `recall_enabled = true` and a real SubAgentLLM. Send "Tell me about the CalDAV project" and inspect the `recall_done` event payload or add temporary logging in `decomposeMessage` to print the raw LLM response. Confirm queries are topically relevant and entities capture proper nouns. |
| reflexive-recall.AC1.2 | Multi-topic message produces 2-4 distinct queries covering each topic | Same as AC1.1 — whether decomposition correctly identifies *distinct topics* in a complex message depends on LLM behaviour that cannot be deterministically asserted. | Send a multi-topic message (e.g., "What's the CalDAV integration status and how does the scheduler work?") with a real SubAgentLLM. Verify the decomposition produces distinct queries for each topic rather than a single merged query. |
| reflexive-recall.AC9.1 | Recall runs after compaction check completes | Fully testing the ordering requires triggering compaction (which needs a long conversation history and real token estimation) alongside recall. The automated test verifies event ordering but cannot easily force compaction in a controlled way without fragile setup. | In a live TUI session with `recall_enabled = true`, build up enough conversation history to trigger compaction (set `context_limit` low). Observe that archive documents created by compaction are immediately available to the recall search on the next turn. |
| reflexive-recall.AC9.2 | Recalled context tokens are not included in compaction threshold estimate | The structural guarantee (recalled context is in system prompt, not history) makes this inherently true, but verifying it requires confirming that the compaction threshold calculation in `chat()` does not reference the system prompt length. | Code review: confirm that `estimateTokens` calls feeding the compaction decision in `src/agent/agent.ts` operate only on `this.history`, not on `systemPrompt`. This is a structural property best verified by inspection. |
