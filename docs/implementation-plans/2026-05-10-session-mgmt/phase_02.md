# Session Management Implementation Plan — Phase 2

**Goal:** Create the Functional Core module with pure functions for slug generation, rkey construction, session classification, and archive document formatting.

**Architecture:** Single file `src/sessions/archive.ts` with pure functions. Uses `formatConversation()` from `src/agent/compaction.ts` for transcript serialization (established cross-module import pattern). YAML frontmatter generated as plain strings — no library needed.

**Tech Stack:** TypeScript, bun:test

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-05-10

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-mgmt.AC2: Pure functions produce correct output
- **session-mgmt.AC2.1 Success:** `slugify("Email Digest")` returns `"email-digest"`
- **session-mgmt.AC2.2 Success:** `slugify(null)` returns `"untitled"`
- **session-mgmt.AC2.3 Edge:** `slugify` strips non-alphanumeric chars, collapses consecutive hyphens, trims leading/trailing hyphens
- **session-mgmt.AC2.4 Success:** `buildArchiveRkey` produces `archive:session:<slug>:<YYYY-MM-DDTHH-MM>` format
- **session-mgmt.AC2.5 Success:** `classifySession` returns `"delete"` for 0-message sessions older than 24h
- **session-mgmt.AC2.6 Success:** `classifySession` returns `"archive"` for sessions with messages but no update in 3 days
- **session-mgmt.AC2.7 Success:** `classifySession` returns `"active"` for recently updated sessions
- **session-mgmt.AC2.8 Success:** `formatArchiveDocument` produces markdown with YAML frontmatter, optional summary, and transcript

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/sessions/archive.ts` with all pure functions

**Files:**
- Create: `src/sessions/archive.ts`

**Implementation:**

Create the Functional Core module with pattern comment `// pattern: Functional Core`.

**Imports:**

```typescript
import type { Message } from '../model/types.ts';
import type { SessionWithCounts } from './types.ts';
import type { SessionClassification } from './types.ts';
import { formatConversation } from '../agent/compaction.ts';
```

**`slugify(title: string | null): string`**

Converts a title to a URL-safe kebab-case slug:
- If `title` is `null` or empty after trimming, return `"untitled"`
- Lowercase the input
- Replace non-alphanumeric characters (except hyphens) with hyphens
- Collapse consecutive hyphens into a single hyphen
- Trim leading/trailing hyphens

**`buildArchiveRkey(title: string | null, updatedAt: string): string`**

Constructs the rkey for an archive document:
- Call `slugify(title)` for the slug portion
- Parse `updatedAt` as a Date, format as `YYYY-MM-DDTHH-MM` (replace `:` in time with `-`)
- Return `archive:session:${slug}:${datetime}`

**`classifySession(messageCount: number, updatedAt: string, now: Date): SessionClassification`**

Classifies a session based on age and message count:
- Calculate age in milliseconds: `now.getTime() - new Date(updatedAt).getTime()`
- If `messageCount === 0` and age > 24 hours (86_400_000 ms): return `"delete"`
- If `messageCount > 0` and age > 3 days (259_200_000 ms): return `"archive"`
- Otherwise: return `"active"`

**`formatArchiveDocument(meta: SessionWithCounts, messages: ReadonlyArray<Message>, archivedAt: string, summary?: string): string`**

Produces the archive markdown document:
- Build YAML frontmatter block with `---` delimiters containing:
  - `title`: `meta.title ?? 'Untitled'`
  - `archived`: the `archivedAt` parameter (ISO timestamp, provided by IS caller)
  - `session_date_range`: `meta.createdAt` + ` – ` + last message timestamp or `meta.updatedAt`
  - `message_count`: `meta.messageCount`
- If `summary` is provided, add `## Summary\n` section with the summary text
- Add `## Transcript\n` section using `formatConversation(messages)`
- Join all sections with double newlines

Note: `formatArchiveDocument` receives model `Message` objects (not store rows), since `formatConversation()` expects `ReadonlyArray<Message>`.

The `archivedAt` parameter is required (not optional) to maintain strict FC purity — no `new Date()` calls inside a Functional Core function. The IS caller in Phase 3 passes `new Date().toISOString()` at call time.

**Verification:**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(sessions): add archive functional core`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for all pure functions in `archive.ts`

**Verifies:** session-mgmt.AC2.1, session-mgmt.AC2.2, session-mgmt.AC2.3, session-mgmt.AC2.4, session-mgmt.AC2.5, session-mgmt.AC2.6, session-mgmt.AC2.7, session-mgmt.AC2.8

**Files:**
- Create: `src/sessions/archive.test.ts`

**Testing:**

Pattern comment: `// pattern: Functional Core (test)`

These are pure function tests — no mocks, no I/O, just input/output assertions.

Tests must verify each AC listed:

**`slugify` tests:**
- **session-mgmt.AC2.1:** `slugify("Email Digest")` returns `"email-digest"`
- **session-mgmt.AC2.2:** `slugify(null)` returns `"untitled"`
- **session-mgmt.AC2.3:** Test with input like `"---Hello!! World---"` — strips non-alphanumeric, collapses consecutive hyphens, trims leading/trailing hyphens. Also test empty string returns `"untitled"`.

**`buildArchiveRkey` tests:**
- **session-mgmt.AC2.4:** `buildArchiveRkey("Email Digest", "2026-05-10T14:30:00Z")` returns `"archive:session:email-digest:2026-05-10T14-30"`. Also test with `null` title to confirm `"untitled"` slug is used.

**`classifySession` tests:**
- **session-mgmt.AC2.5:** 0 messages, `updatedAt` 25 hours ago → returns `"delete"`
- **session-mgmt.AC2.6:** 10 messages, `updatedAt` 4 days ago → returns `"archive"`
- **session-mgmt.AC2.7:** 5 messages, `updatedAt` 1 hour ago → returns `"active"`
- Also test boundary cases: 0 messages but only 23 hours old → `"active"` (not yet stale enough to delete). Messages present but only 2 days old → `"active"` (not yet stale enough to archive).

**`formatArchiveDocument` tests:**
- **session-mgmt.AC2.8:** Call with a `SessionWithCounts` object, a message array, a fixed `archivedAt` string, and a summary string. Assert output contains YAML frontmatter with `---` delimiters, title, archived date matching the `archivedAt` value, session_date_range, message_count. Assert `## Summary` section present with summary text. Assert `## Transcript` section present.
- Also test without summary: call without the summary parameter (still pass `archivedAt`). Assert `## Summary` section is absent, but `## Transcript` section is still present.

Use fixed dates (not `Date.now()`) for deterministic assertions. Pass `archivedAt` explicitly in tests.

**Verification:**

Run: `bun test src/sessions/archive.test.ts`
Expected: All tests pass

**Commit:** `test(sessions): add archive functional core tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
