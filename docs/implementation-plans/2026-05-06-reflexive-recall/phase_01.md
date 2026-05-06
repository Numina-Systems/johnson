# Reflexive Recall Implementation Plan — Phase 1: Decomposition Module

**Goal:** Parse user messages into semantic queries and named entities via SubAgentLLM.

**Architecture:** A Functional Core module (`src/recall/decompose.ts`) that takes a user message, calls SubAgentLLM with a structured prompt requesting JSON output, and returns typed decomposition results. Parsing logic is separated from the LLM call for testability.

**Tech Stack:** TypeScript, Bun, SubAgentLLM (internal)

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-05-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC1: Decomposition
- **reflexive-recall.AC1.1 Success:** Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"]
- **reflexive-recall.AC1.2 Success:** Multi-topic message produces 2-4 distinct queries covering each topic
- **reflexive-recall.AC1.3 Edge:** Single-word message produces one query containing that word
- **reflexive-recall.AC1.4 Edge:** Message with no proper nouns produces empty entities array

### reflexive-recall.AC5: Fallback Cascade (partial — SubAgentLLM failure only)
- **reflexive-recall.AC5.1 Success:** SubAgentLLM failure falls back to raw message as single hybridSearch query
- **reflexive-recall.AC5.2 Success:** Malformed JSON from SubAgentLLM triggers same fallback

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: DecompositionResult type and parseDecompositionResponse

**Verifies:** reflexive-recall.AC1.1, reflexive-recall.AC1.2, reflexive-recall.AC1.3, reflexive-recall.AC1.4, reflexive-recall.AC5.2

**Files:**
- Create: `src/recall/decompose.ts`

**Implementation:**

Create `src/recall/decompose.ts` with pattern annotation `// pattern: Functional Core`.

Define the `DecompositionResult` type:

```typescript
export type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};
```

Implement `parseDecompositionResponse(raw: string): DecompositionResult`:

1. Attempt `JSON.parse(raw)` — if it throws, return fallback (see below).
2. Validate the parsed object has `queries` (array of strings) and `entities` (array of strings). Use runtime type checks (`Array.isArray`, `typeof === 'string'`).
3. Filter out empty strings from both arrays.
4. Cap `queries` at 4 items (design specifies 1-4).
5. If validation fails at any point, return the fallback: `{ queries: [], entities: [] }`.

The function is pure — no I/O, no SubAgentLLM call. It only parses and validates a raw string.

Also implement a helper `fallbackDecomposition(message: string): DecompositionResult`:

```typescript
export function fallbackDecomposition(message: string): DecompositionResult {
  return { queries: [message.trim()], entities: [] };
}
```

This is used when SubAgentLLM fails or returns garbage — the raw message becomes the single query.

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): add DecompositionResult type and parseDecompositionResponse`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: decomposeMessage function

**Verifies:** reflexive-recall.AC1.1, reflexive-recall.AC1.2, reflexive-recall.AC5.1, reflexive-recall.AC5.2

**Files:**
- Modify: `src/recall/decompose.ts`

**Implementation:**

Add `decomposeMessage(message: string, subAgent: SubAgentLLM): Promise<DecompositionResult>` to `decompose.ts`.

Import `SubAgentLLM` type from `../model/sub-agent.ts`.

The function:

1. Builds a prompt asking the SubAgentLLM to decompose the message into semantic queries and named entities. The prompt should request JSON output matching `{ "queries": [...], "entities": [...] }`.
2. Builds a system prompt: short instruction telling the sub-agent to return only valid JSON, no markdown fencing, no explanation.
3. Calls `subAgent.complete(prompt, system)`.
4. Passes the result to `parseDecompositionResponse()`.
5. If `parseDecompositionResponse` returns empty queries (malformed JSON case), return `fallbackDecomposition(message)` instead.
6. Wraps the entire SubAgentLLM call in try/catch — on any error, return `fallbackDecomposition(message)`. This handles AC5.1 (SubAgentLLM failure).

The prompt for SubAgentLLM should be something like:

```
Decompose this user message into search queries and named entities.

Message: "${message}"

Return JSON only:
{"queries": ["query1", "query2"], "entities": ["Entity1", "Entity2"]}

Rules:
- queries: 1-4 short phrases (2-6 words each) that capture the distinct topics in the message
- entities: proper nouns, project names, people, or specific terms for direct lookup
- If the message is simple, one query is fine
- If there are no proper nouns, entities should be an empty array
```

**Verification:**

```bash
bun run build
```

Expected: Build succeeds with no type errors.

**Commit:** `feat(recall): add decomposeMessage with SubAgentLLM integration`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Decomposition tests

**Verifies:** reflexive-recall.AC1.1, reflexive-recall.AC1.2, reflexive-recall.AC1.3, reflexive-recall.AC1.4, reflexive-recall.AC5.1, reflexive-recall.AC5.2

**Files:**
- Create: `src/recall/decompose.test.ts`

**Testing:**

Use `bun:test` with `describe`/`test`/`expect`. Import from `bun:test`. Follow the project's existing mock pattern from `src/agent/compaction.test.ts` — create a `makeMockSubAgent(response)` helper that captures calls and returns a preset response.

Tests must verify each AC listed:

**parseDecompositionResponse tests:**

- **reflexive-recall.AC1.1:** Valid JSON `{"queries":["CalDAV project"],"entities":["CalDAV"]}` returns correct `DecompositionResult` with matching queries and entities arrays.
- **reflexive-recall.AC1.2:** Valid JSON with 3 queries returns all 3 queries.
- **reflexive-recall.AC1.3:** Valid JSON with single-word query returns one query containing that word.
- **reflexive-recall.AC1.4:** Valid JSON with `"entities":[]` returns empty entities array.
- **reflexive-recall.AC5.2 (malformed JSON):** Non-JSON string returns `{ queries: [], entities: [] }`.
- Additional edge cases: JSON with extra fields (should be ignored), queries array with empty strings (should be filtered), more than 4 queries (should be capped at 4).

**decomposeMessage tests:**

- **reflexive-recall.AC1.1:** Mock SubAgentLLM returns valid JSON for "Tell me about the CalDAV project" — verify result contains expected queries and entities. Also verify the SubAgentLLM was called with a prompt containing the user message.
- **reflexive-recall.AC5.1 (SubAgentLLM failure):** Mock SubAgentLLM that throws an Error — verify result is `fallbackDecomposition(message)` (raw message as single query, empty entities).
- **reflexive-recall.AC5.2 (malformed JSON from LLM):** Mock SubAgentLLM returns non-JSON string — verify result is `fallbackDecomposition(message)`.

**fallbackDecomposition tests:**

- Returns single query containing the trimmed message.
- Returns empty entities array.

**Verification:**

```bash
bun test src/recall/decompose.test.ts
```

Expected: All tests pass.

**Commit:** `test(recall): add decomposition unit tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
