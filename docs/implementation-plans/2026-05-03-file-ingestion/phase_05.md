# File Ingestion Implementation Plan — Phase 5

**Goal:** Graceful error handling for missing files, binary files, oversized files, and clear actionable error messages returned as tool results.

**Architecture:** Add validation guards at the top of the `ingest_file` handler in `src/tools/ingest.ts`, before file reading. Each guard returns an error message as the tool result (never throws). Guards execute in order: path security → file existence → size check → binary detection.

**Tech Stack:** `node:fs/promises` for stat/readdir, `Bun.file()` for reading. No new dependencies.

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-05-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### file-ingestion.AC1: Path resolution and security
- **file-ingestion.AC1.5 Failure:** Non-existent file returns error with directory listing hint
- **file-ingestion.AC1.6 Failure:** Binary file detected and rejected
- **file-ingestion.AC1.7 Failure:** File exceeding ~400KB rejected with size info

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: File existence check with directory listing hint

**Verifies:** file-ingestion.AC1.5

**Files:**
- Modify: `src/tools/ingest.ts` (add existence guard after path resolution)

**Implementation:**

After path resolution and traversal check, before reading content:

```typescript
import { stat, readdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

// Check file exists
try {
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    return JSON.stringify({
      error: `Path is a directory, not a file: ${userPath}`,
      tokenEstimate: 0,
    });
  }
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    // List files in parent directory as hint
    const dir = dirname(resolvedPath);
    let hint = '';
    try {
      const entries = await readdir(dir);
      const textFiles = entries.filter(e => !e.startsWith('.')).slice(0, 10);
      if (textFiles.length > 0) {
        hint = `\nFiles in ${dirname(userPath) || '.'}:\n${textFiles.map(f => `  ${f}`).join('\n')}`;
      }
    } catch { /* directory might not exist either */ }

    return JSON.stringify({
      error: `File not found: ${userPath}${hint}`,
      tokenEstimate: 0,
    });
  }
  throw err;
}
```

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: File-not-found tests pass

**Commit:** `feat(ingest): add file existence check with directory listing hint`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Size limit and binary detection guards

**Verifies:** file-ingestion.AC1.6, file-ingestion.AC1.7

**Files:**
- Modify: `src/tools/ingest.ts` (add size and binary guards)

**Implementation:**

Constants:
```typescript
const MAX_FILE_SIZE_BYTES = 400_000;  // ~400KB
```

After stat check confirms file exists:

**Size guard:**
```typescript
if (fileStat.size > MAX_FILE_SIZE_BYTES) {
  const sizeKb = Math.round(fileStat.size / 1024);
  return JSON.stringify({
    error: `File too large: ${userPath} (${sizeKb}KB). Maximum is ~400KB.`,
    tokenEstimate: Math.ceil(fileStat.size / 4),
  });
}
```

**Binary detection (after reading content):**

Read the file, then scan for null bytes in the first 8KB:
```typescript
const content = await Bun.file(resolvedPath).text();
const sample = content.slice(0, 8192);
if (sample.includes('\0')) {
  return JSON.stringify({
    error: `Binary file detected: ${userPath}. Only text files are supported.`,
    tokenEstimate: 0,
  });
}
```

**Guard order in handler:**
1. Path resolution + traversal check (Phase 1)
2. File existence + stat (this phase, Task 1)
3. Size limit check (this task)
4. Read file content
5. Binary detection (this task)
6. Token estimation + intent dispatch (Phase 1-4)

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: Size and binary detection tests pass

**Commit:** `feat(ingest): add size limit and binary file detection`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Error handling tests

**Verifies:** file-ingestion.AC1.5, file-ingestion.AC1.6, file-ingestion.AC1.7

**Files:**
- Modify: `src/tools/ingest.test.ts` (add error handling test describe block)

**Testing:**

Use temp directory with appropriate fixtures. For binary detection, write a file with null bytes.

Test cases:
- **file-ingestion.AC1.5 — non-existent file:**
  - Call with `path: 'does-not-exist.md'`
  - Verify JSON result has `error` field mentioning "not found"
  - Verify directory listing hint is present (create a sibling file in same dir)
  - Verify no exception thrown

- **file-ingestion.AC1.6 — binary file:**
  - Write a file with null bytes: `Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f])`
  - Call `ingest_file` with that path
  - Verify JSON result has `error` field mentioning "binary"
  - Verify no store writes occurred

- **file-ingestion.AC1.7 — oversized file:**
  - Write a file larger than 400KB (e.g., 'x'.repeat(500_000))
  - Call `ingest_file` with that path
  - Verify JSON result has `error` field mentioning size
  - Verify includes the file's actual size
  - Verify no file read attempt (handler returns before reading content — can verify by checking stat is called but file content isn't processed)

**Verification:**
Run: `bun test src/tools/ingest.test.ts`
Expected: All error handling tests pass

Run: `bun test`
Expected: Full suite passes (no regressions)

**Commit:** `test(ingest): add error handling edge case tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
