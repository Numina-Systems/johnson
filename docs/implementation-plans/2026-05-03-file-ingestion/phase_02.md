# File Ingestion Implementation Plan — Phase 2

**Goal:** Large files (>4k tokens) are split into semantic chunks (~2k tokens each) with parent heading context preserved.

**Architecture:** Pure function `chunkText()` in `src/tools/ingest.ts` (or extracted to `src/tools/ingest/chunker.ts` if the file gets large). Uses the existing `estimateTokens()` from `src/agent/context.ts`. Split priority: markdown headers → double newlines → sentence boundaries. Each chunk carries its index and parent heading context.

**Tech Stack:** No new dependencies. Pure string manipulation with existing `estimateTokens()`.

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-05-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### file-ingestion.AC5: Chunking and summarisation
- **file-ingestion.AC5.1 Success:** Files over ~4k tokens are chunked into ~2k-token segments
- **file-ingestion.AC5.2 Success:** Chunks split on markdown headers, then paragraph breaks, then sentences
- **file-ingestion.AC5.3 Success:** Parent heading context prepended to each chunk

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Chunk type definition and `estimateTokens` re-export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/tools/ingest.ts` (add type and import)

**Implementation:**

Add chunk type at top of `src/tools/ingest.ts`:

```typescript
import { estimateTokens } from '../agent/context.ts';

type Chunk = {
  readonly index: number;
  readonly content: string;
  readonly heading: string;
  readonly tokenEstimate: number;
};
```

Constants:
```typescript
const LARGE_FILE_THRESHOLD = 4096;  // tokens
const TARGET_CHUNK_SIZE = 2048;     // tokens
```

**Verification:**
Run: `bun run build`
Expected: Build succeeds (types are valid)

**Commit:** `feat(ingest): add Chunk type and token constants`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `chunkText()` function

**Verifies:** file-ingestion.AC5.1, file-ingestion.AC5.2, file-ingestion.AC5.3

**Files:**
- Modify: `src/tools/ingest.ts` (add `chunkText` function)

**Implementation:**

Pure function with signature:
```typescript
function chunkText(text: string): Array<Chunk>
```

Algorithm:
1. If `estimateTokens(text) <= LARGE_FILE_THRESHOLD`, return single chunk (whole text)
2. First pass: split on markdown headers (`/^#{1,6} .+/m`)
   - Track current heading context (last heading seen at each level)
   - Each section becomes a candidate chunk
3. Second pass: for any candidate chunk exceeding `TARGET_CHUNK_SIZE` tokens, split on double newlines (`\n\n`)
4. Third pass: for any chunk still exceeding `TARGET_CHUNK_SIZE`, split on sentence boundaries (`. ` followed by uppercase letter, or `.\n`)
5. Assign sequential index to each final chunk
6. Prepend parent heading context to chunks that aren't the first in their section

**Heading context logic:**
- Maintain a stack of headings by level (h1 through h6)
- When a new heading is encountered, update the stack at that level and clear deeper levels
- Each chunk's `heading` field is the most recent ancestor heading (or empty string for content before any heading)

**Splitting on headers preserves the header in the chunk that follows it.** The header line stays with its content, not orphaned at the end of the previous chunk.

**Edge cases:**
- File with no markdown headers: splits on paragraphs directly
- Very long paragraph with no sentence breaks: hard-cut at `TARGET_CHUNK_SIZE * 1.5` as last resort
- Empty chunks after split: filter out

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All chunking tests pass

**Commit:** `feat(ingest): implement semantic chunking with heading context`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Chunking tests

**Verifies:** file-ingestion.AC5.1, file-ingestion.AC5.2, file-ingestion.AC5.3

**Files:**
- Modify: `src/tools/ingest.test.ts` (add chunking test describe block)

**Testing:**

Export `chunkText` for testing (or test via the tool handler with a large file). Direct export is cleaner for unit tests.

Test cases:
- **file-ingestion.AC5.1 — size threshold:**
  - Small file (< 4096 tokens): returns single chunk with full content
  - Large file (> 4096 tokens): returns multiple chunks each ≤ ~2048 tokens (allow 1.5x overshoot for hard-cut edge case)
  - Verify no chunk exceeds `TARGET_CHUNK_SIZE * 1.5`

- **file-ingestion.AC5.2 — split priority:**
  - Markdown file with headers: chunks split at header boundaries (verify chunk starts with `#`)
  - File with no headers but paragraphs: chunks split at `\n\n` boundaries
  - Dense text with only sentence breaks: chunks split at sentence boundaries
  - Very long paragraph with no sentence breaks: hard-cut at `TARGET_CHUNK_SIZE * 1.5` (generate a single long string of words without periods)

- **file-ingestion.AC5.3 — heading context:**
  - Chunk from "## Setup" section under "# Getting Started" has heading "## Setup" (or includes parent context)
  - First chunk (before any heading) has empty heading string
  - Chunk after level change carries updated heading

**Test fixture strategy:**
Generate test content programmatically — e.g., repeat a paragraph N times to exceed threshold, or build a markdown doc with known heading structure.

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All chunking tests pass

**Commit:** `test(ingest): add chunking pipeline tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Integrate chunking into `ingest_file` handler

**Verifies:** file-ingestion.AC5.1

**Files:**
- Modify: `src/tools/ingest.ts` (update handler to call `chunkText` for large files)

**Implementation:**

In the `ingest_file` handler, after reading the file and estimating tokens:

```typescript
const tokenEstimate = estimateTokens(content);

if (tokenEstimate <= LARGE_FILE_THRESHOLD) {
  // Existing small-file dispatch (Phase 1)
  return dispatchSmallFile(content, intent, filename, deps);
}

// Large file path
const chunks = chunkText(content);
// Phase 3 will add summarisation here — for now, return a placeholder
return JSON.stringify({
  content: `File has ${chunks.length} chunks (${tokenEstimate} tokens). Summarisation not yet implemented.`,
  tokenEstimate,
  chunks: chunks.length,
});
```

This wires chunking into the pipeline while deferring summarisation to Phase 3. The tool remains functional — it tells the agent the file is large and how many chunks it would produce.

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All tests pass (existing + new integration test for large file returning chunk count)

**Commit:** `feat(ingest): integrate chunking pipeline for large files`

<!-- END_TASK_4 -->
