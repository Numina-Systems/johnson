# File Ingestion Implementation Plan — Phase 3

**Goal:** Chunks are summarised via `SubAgentLLM`, producing per-chunk summaries and a roll-up summary.

**Architecture:** Summarisation orchestrator function in `src/tools/ingest.ts` iterates chunks sequentially, calls `deps.subAgent.complete()` for each, then produces a roll-up from the per-chunk summaries. Intent-aware system prompts guide extraction (memory intent extracts identity facts, knowledge intent produces reference summaries). Uses existing `SubAgentLLM` interface (`complete(prompt, system): Promise<string>`).

**Tech Stack:** Existing `SubAgentLLM` from `src/model/sub-agent.ts`. No new dependencies.

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-05-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### file-ingestion.AC2: Intent routing — memory
- **file-ingestion.AC2.2 Success:** Large file with memory intent extracts identity facts from summary and appends to self

### file-ingestion.AC4: Intent routing — context
- **file-ingestion.AC4.2 Success:** Large file returns roll-up summary as tool result, nothing persisted

### file-ingestion.AC5: Chunking and summarisation
- **file-ingestion.AC5.4 Success:** Sub-agent produces per-chunk summaries and roll-up
- **file-ingestion.AC5.5 Failure:** Sub-agent failure falls back to naive truncation with warning

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Summarisation orchestrator function

**Verifies:** file-ingestion.AC5.4

**Files:**
- Modify: `src/tools/ingest.ts` (add `summarizeChunks` function)

**Implementation:**

Add an async function:
```typescript
type SummarizationResult = {
  readonly perChunk: ReadonlyArray<string>;
  readonly rollUp: string;
};

async function summarizeChunks(
  chunks: ReadonlyArray<Chunk>,
  intent: 'memory' | 'knowledge' | 'context',
  subAgent: SubAgentLLM,
): Promise<SummarizationResult>
```

Algorithm:
1. Define system prompt based on intent:
   - **memory:** "You are extracting identity facts about a person or agent from a document chunk. Output only factual statements about who they are, what they do, their preferences, and their relationships. Be concise — bullet points."
   - **knowledge:** "You are summarizing a document chunk for future reference. Capture the key information, decisions, and details that would be useful when searching for this content later. Be concise but complete."
   - **context:** "You are summarizing a document chunk to give the reader a quick understanding of its content. Focus on the main points and any actionable information."

2. For each chunk, call `subAgent.complete(chunk.content, chunkSystemPrompt)` sequentially
3. Collect per-chunk summaries into array
4. Build roll-up prompt: combine all per-chunk summaries, ask for a single concise summary
5. Call `subAgent.complete(combinedSummaries, rollUpSystemPrompt)` for the roll-up

Roll-up system prompt:
- "You are creating a single concise summary from multiple chunk summaries of the same document. Synthesize the key points into 2-5 sentences that capture the document's essential content. Do not use bullet points or headers."

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: Summarisation tests pass

**Commit:** `feat(ingest): add sub-agent summarisation orchestrator`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integrate summarisation into large-file handler path

**Verifies:** file-ingestion.AC2.2, file-ingestion.AC4.2, file-ingestion.AC5.4

**Files:**
- Modify: `src/tools/ingest.ts` (replace Phase 2's placeholder large-file handling with summarisation)

**Implementation:**

Replace the placeholder in the large-file path with actual summarisation:

```typescript
// Large file path
const chunks = chunkText(content);

if (!deps.subAgent) {
  // No sub-agent configured — fall back to truncation
  const truncated = content.slice(0, LARGE_FILE_THRESHOLD * 4);
  return JSON.stringify({
    content: `[truncated — sub-agent not configured] ${truncated}`,
    tokenEstimate,
    chunks: chunks.length,
  });
}

const { perChunk, rollUp } = await summarizeChunks(chunks, intent, deps.subAgent);
```

Then dispatch by intent for large files:
- **context:** Return roll-up summary as tool result, nothing persisted
- **memory:** Extract identity facts from roll-up, append to self with `<!-- from: filename -->` separator (same as small-file memory, but using the roll-up content)
- **knowledge:** Handled in Phase 4 (store summary + chunks)

For now, knowledge intent with large files stores just the roll-up as `knowledge:<name>` (Phase 4 adds chunk documents).

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All tests pass

**Commit:** `feat(ingest): wire summarisation into large-file intent dispatch`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Summarisation and fallback tests

**Verifies:** file-ingestion.AC2.2, file-ingestion.AC4.2, file-ingestion.AC5.4, file-ingestion.AC5.5

**Files:**
- Modify: `src/tools/ingest.test.ts` (add summarisation test describe block)

**Testing:**

Mock `SubAgentLLM` — create a mock that returns predictable summaries:
```typescript
const mockSubAgent: SubAgentLLM = {
  complete: mock(async (prompt: string, system?: string) => {
    return `Summary of: ${prompt.slice(0, 50)}...`;
  }),
};
```

Test cases:
- **file-ingestion.AC5.4 — per-chunk summaries and roll-up:**
  - Create large file content (>4k tokens)
  - Call `ingest_file` with `intent: 'context'`
  - Verify `mockSubAgent.complete` was called N times (once per chunk + once for roll-up)
  - Verify result contains the roll-up text

- **file-ingestion.AC2.2 — memory intent with large file:**
  - Call `ingest_file` with large file and `intent: 'memory'`
  - Verify `store.docGet('self')` contains the summarised content
  - Verify `<!-- from: filename -->` separator is present

- **file-ingestion.AC4.2 — context intent with large file:**
  - Call `ingest_file` with large file and `intent: 'context'`
  - Verify result contains roll-up summary
  - Verify no document was persisted to store

- **file-ingestion.AC5.5 — sub-agent failure fallback:**
  - Create mock sub-agent that throws an error
  - Call `ingest_file` with large file
  - Verify result contains truncated content with warning
  - Verify no crash/unhandled rejection

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All tests pass

**Commit:** `test(ingest): add summarisation and fallback tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Sub-agent failure fallback implementation

**Verifies:** file-ingestion.AC5.5

**Files:**
- Modify: `src/tools/ingest.ts` (add try/catch around summarisation)

**Implementation:**

Wrap the `summarizeChunks` call in try/catch:

```typescript
let rollUp: string;
let chunkCount = chunks.length;

try {
  const result = await summarizeChunks(chunks, intent, deps.subAgent);
  rollUp = result.rollUp;
} catch {
  // Fallback: truncate to first ~4k tokens with warning
  const truncated = content.slice(0, LARGE_FILE_THRESHOLD * 4);
  rollUp = `[summarisation failed — showing first ~${LARGE_FILE_THRESHOLD} tokens]\n\n${truncated}`;
}
```

This ensures the tool never throws to the model — it always returns something useful.

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: Fallback test passes

**Commit:** `feat(ingest): add graceful fallback for sub-agent failures`

<!-- END_TASK_4 -->
