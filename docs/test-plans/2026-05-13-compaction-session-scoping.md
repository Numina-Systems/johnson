# Human Test Plan: Compaction Session Scoping

## Prerequisites

- Working checkout at commit `58b858b` or later
- `bun test` passes (81 tests, 0 failures across 4 test files)
- Ability to read `CLAUDE.md` in a text editor or `git diff`

## Phase 1: Documentation — rkey Prefix Updates (AC4.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `CLAUDE.md` | File opens |
| 2 | Navigate to "Documents & Memory" section, find the rkey prefix list | List is present under `### Persistent Store` |
| 3 | Verify `context:<sessionId>:<timestamp>` appears in the prefix list | Entry reads: `context:<sessionId>:<timestamp>` — session-scoped context compaction snapshots |
| 4 | Verify the compaction description paragraph references the new format | Paragraph should read: "saves the current conversation as a `context:<sessionId>:<timestamp>` document scoped to the current session" — no mention of `archive:<timestamp>` as a current format |
| 5 | Verify `archivist:compaction-migration` appears in the rkey prefix list | Entry reads: `archivist:compaction-migration` — marker for compaction archive migration idempotency |

## Phase 2: Documentation — Immutability Boundaries (AC4.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to the "Immutability Boundaries" subsection under "Archivist" | Section is present |
| 2 | Check the count of immutable prefixes | Text reads "four immutable prefixes" (not "three") |
| 3 | Verify `context:*` appears in the immutability list | Entry reads: `context:*` — Session-scoped compaction snapshots. Transient context managed by compaction, not durable knowledge. |
| 4 | Navigate to the "New rkey Prefixes" section under "Archivist" | Section is present |
| 5 | Verify `context:*` is listed there | Entry reads: `context:*` — Session-scoped compaction snapshots. Transient — archivist never modifies. |

## Phase 3: Documentation — Removal of Old Format (AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Search CLAUDE.md for `archive:<timestamp>` (literally, with angle brackets) | Should NOT appear as a current/active rkey format |
| 2 | In the rkey prefix list, verify the compaction entry | Should be `context:<sessionId>:<timestamp>`, not `archive:<timestamp>` |
| 3 | In the context compaction description paragraph | Should reference `context:`, not `archive:`, for compaction snapshots |

## End-to-End: Cross-Session Isolation Narrative

**Purpose:** Validate that the complete flow — from `compactContext` invocation through document storage through archivist protection — forms an unbroken chain of session isolation.

1. In `compaction.ts`, confirm `contextRkey()` builds `context:${sessionId}:${ts}` (line 54)
2. In `compaction.ts`, confirm `listContextDocs()` filters using `startsWith(prefix)` where prefix includes the sessionId (lines 61-62)
3. In `state.ts`, confirm `IMMUTABLE_PREFIXES` includes `'context:'` (line 6)
4. In `consolidate.ts`, confirm `isArchiveRkey()` returns `false` for `context:*` — verified by test at consolidate.test.ts line 69-71
5. In `migration.ts`, confirm `migrateCompactionArchives` skips `archive:session:*` and `archive:consolidated:*` but deletes bare `archive:<timestamp>` docs (lines 92-94)
6. In `index.ts`, confirm `migrateCompactionArchives` is called at startup outside archivist guard

## End-to-End: Migration Safety

**Purpose:** Validate that migrating from the old `archive:*` compaction format does not destroy session archives or consolidated archives.

1. Review `migration.ts` lines 88-98: explicitly skips `archive:session:*` and `archive:consolidated:*`
2. The marker document at `archivist:compaction-migration` prevents re-runs
3. Integration tests (`migration.test.ts` lines 245-275) exercise a mixed-document scenario with all three archive subtypes

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 — session-scoped rkey format | `compaction.test.ts:writes context document with session-scoped rkey` | — |
| AC1.2 — `listContextDocs` filtering | `compaction.test.ts:sessions do not see each other's context documents` | — |
| AC1.3 — cross-session isolation | `compaction.test.ts:sessions do not see each other's context documents` | — |
| AC1.4 — summarization session-scoped | `compaction.test.ts:uses sub-agent for summarization when older context docs exist` | — |
| AC1.5 — default sessionId fallback | `compaction.test.ts:uses "default" session when sessionId is not provided` | — |
| AC2.1 — `isImmutable` for context: | `state.test.ts:returns true for context: prefix` | — |
| AC2.2 — `filterMutable` strips context: | `state.test.ts:removes context: rkeys from all changeset lists` | — |
| AC2.3 — `isArchiveRkey` excludes context: | `consolidate.test.ts:returns false for context: prefix` | — |
| AC3.1 — migration deletes orphans | `migration.test.ts:deletes archive:<timestamp> documents` | — |
| AC3.2 — preserves session archives | `migration.test.ts:preserves archive:session:* documents` | — |
| AC3.3 — preserves consolidated archives | `migration.test.ts:preserves archive:consolidated:* documents` | — |
| AC3.4 — writes marker document | `migration.test.ts:writes migration marker document` | — |
| AC3.5 — idempotent migration | `migration.test.ts:is idempotent when marker exists` | — |
| AC4.1 — CLAUDE.md rkey prefix list | — | Phase 1 steps 2-5 |
| AC4.2 — CLAUDE.md immutability section | — | Phase 2 steps 1-5 |
| AC4.3 — old format removed from CLAUDE.md | — | Phase 3 steps 1-3 |
