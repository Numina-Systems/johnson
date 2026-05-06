# Human Test Plan: Reflexive Recall

## Prerequisites

- Agent configured with `recall_enabled = true` in `config.toml`
- A real SubAgentLLM configured via `[sub_model]` section
- A real embedding provider configured (e.g., OpenAI embeddings)
- SQLite store seeded with at least 3 `knowledge:*` documents, 1 `skill:*` document, and a `self` document
- All automated tests passing: `bun test src/recall/ src/agent/context.test.ts src/agent/agent.test.ts`

## Phase 1: Decomposition Quality (Human Judgment Required)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the agent TUI with `bun start`. Verify the agent loads without errors. | TUI sessions screen appears. |
| 2 | Create a new session and send: "Tell me about the CalDAV project" | Agent responds. No errors in console output. |
| 3 | Add temporary logging in `src/recall/decompose-message.ts` (before the `return` in `decomposeMessage`) to print the raw SubAgentLLM response, or inspect the `recall_done` event payload in the TUI event stream. | Decomposition JSON is visible. |
| 4 | Verify the decomposition contains queries semantically related to "CalDAV project" (e.g., `["CalDAV project"]`, `["CalDAV integration"]`, or similar). | Queries are topically relevant, not generic. |
| 5 | Verify the entities array contains `"CalDAV"` or similar proper nouns. | Entities capture project/technology names from the message. |
| 6 | Send: "What's the CalDAV integration status and how does the scheduler work?" | Agent responds. |
| 7 | Inspect the decomposition for this multi-topic message. | At least 2 distinct queries are produced (one CalDAV-related, one scheduler-related). Queries are not merged into a single string. |

## Phase 2: End-to-End Recall Pipeline

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure the store contains `knowledge:caldav` with CalDAV-related content (use `tools.doc_upsert('knowledge:caldav', '...')` via execute_code or seed via the agent). | Document stored. |
| 2 | Send: "How does CalDAV synchronization work?" | Agent responds with content that references or is informed by the stored CalDAV knowledge document. |
| 3 | Press `p` to view the system prompt. Scroll to find the `## Recalled Context` section. | Section is present, positioned after `## Your Memory` and before `## Available Skills`. |
| 4 | Verify each recalled fragment shows a `### rkey` header followed by content text. No score numbers, no metadata fields. | Clean formatting: `### knowledge:caldav` followed by the document content. |
| 5 | Send a very short message: "hi" | Agent responds normally. |
| 6 | Press `p` to view the system prompt. | No `## Recalled Context` section is present (guard condition: message < 10 chars skips recall). |

## Phase 3: Compaction + Recall Ordering

| Step | Action | Expected |
|------|--------|----------|
| 1 | In `config.toml`, set `context_limit` to a low value (e.g., 2000 tokens) so compaction triggers after a few messages. Keep `recall_enabled = true`. | Config saved. |
| 2 | Start a new session. Send 5-6 substantial messages (each 200+ words) to build up conversation history until compaction triggers. Watch for `archive:*` document creation in agent output or logs. | Compaction triggers after sufficient history accumulates. An `archive:*` document is created. |
| 3 | On the next message after compaction, send: "What did we discuss earlier about [topic from your previous messages]?" | Agent responds. The recall system picks up content from the newly created `archive:*` document or from any `knowledge:*` documents. |
| 4 | Verify the `recall_done` event fires before `llm_start` by checking event logs or adding temporary logging to `src/agent/agent.ts` at the event emission points. | `recall_done` timestamp precedes `llm_start` timestamp in the event sequence. |

## Phase 4: Verify Compaction Threshold Independence (Code Review)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/agent/agent.ts` and locate the compaction decision logic (the call to `estimateTokens` or `shouldCompact` or similar that feeds the compaction threshold). | Code location identified. |
| 2 | Confirm that the token estimation for the compaction decision operates on `this.history` (the message array) and does not include the system prompt string or any recalled context. | The compaction threshold calculation references only the conversation history, not the system prompt. Recalled context (which is injected into the system prompt) does not inflate the compaction estimate. |

## End-to-End: Full Fallback Cascade

1. Start the agent with `recall_enabled = true`, a valid SubAgentLLM, and a valid embedding provider. Seed the store with `knowledge:test-doc` containing "test fallback cascade content".
2. Send: "Tell me about the test fallback cascade content" -- verify recall finds the document.
3. Stop the embedding provider (e.g., remove the API key from secrets, or set an invalid base URL for the embedding endpoint).
4. Restart the agent. Send the same message.
5. Verify the agent still responds and recall returns FTS-based results (the `recall_done` event should still fire, with `fragmentCount >= 0`).
6. Additionally, remove or invalidate the `[sub_model]` config section so SubAgentLLM is unavailable.
7. Restart the agent. Send the same message.
8. Verify the agent still responds. Recall falls back to raw-message FTS search. The `recall_done` event still fires.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC1.1 (decomposition quality) | SubAgentLLM output is non-deterministic; whether queries are semantically appropriate requires human judgment | Phase 1, Steps 2-5 |
| AC1.2 (multi-topic decomposition) | Whether decomposition correctly identifies distinct topics depends on LLM behavior | Phase 1, Steps 6-7 |
| AC9.1 (compaction/recall ordering) | Triggering compaction requires long conversation history and real token estimation | Phase 3, Steps 1-4 |
| AC9.2 (compaction threshold independence) | Structural guarantee best verified by code inspection | Phase 4, Steps 1-2 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `decompose.test.ts`, `decompose-message.test.ts` | Phase 1, Steps 2-5 |
| AC1.2 | `decompose.test.ts` | Phase 1, Steps 6-7 |
| AC1.3 | `decompose.test.ts` | -- |
| AC1.4 | `decompose.test.ts` | -- |
| AC2.1 | `retrieve.test.ts` | -- |
| AC2.2 | `retrieve.test.ts` | -- |
| AC2.3 | `retrieve.test.ts` | -- |
| AC3.1 | `retrieve.test.ts` | -- |
| AC3.2 | `retrieve.test.ts` | -- |
| AC3.3 | `retrieve.test.ts` | -- |
| AC4.1 | `retrieve.test.ts` | -- |
| AC4.2 | `retrieve.test.ts` | -- |
| AC4.3 | `context.test.ts` | -- |
| AC5.1 | `decompose-message.test.ts`, `index.test.ts` | Fallback Cascade, Steps 6-8 |
| AC5.2 | `decompose.test.ts`, `decompose-message.test.ts`, `index.test.ts` | -- |
| AC5.3 | `index.test.ts` | Fallback Cascade, Steps 3-5 |
| AC5.4 | `index.test.ts` | Fallback Cascade, Steps 6-8 |
| AC6.1 | `agent.test.ts` | -- |
| AC6.2 | `index.test.ts` | Phase 2, Steps 5-6 |
| AC6.3 | `index.test.ts` | -- |
| AC6.4 | `index.test.ts` | -- |
| AC7.1 | `context.test.ts` | Phase 2, Steps 3-4 |
| AC7.2 | `context.test.ts` | Phase 2, Step 4 |
| AC7.3 | `context.test.ts` | Phase 2, Step 6 |
| AC8.1 | `agent.test.ts` | -- |
| AC8.2 | `agent.test.ts` | -- |
| AC9.1 | `agent.test.ts` | Phase 3, Steps 1-4 |
| AC9.2 | `agent.test.ts` (structural) | Phase 4, Steps 1-2 |
