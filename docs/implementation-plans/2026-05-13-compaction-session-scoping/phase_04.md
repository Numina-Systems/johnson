# Compaction Session Scoping Implementation Plan — Phase 4

**Goal:** Update CLAUDE.md to reflect the new `context:` prefix conventions, session scoping, and immutability.

**Architecture:** Documentation-only phase. Four targeted edits to CLAUDE.md: replace the old `archive:<timestamp>` compaction rkey with `context:<sessionId>:<timestamp>`, update the compaction description to mention session scoping, add `context:*` to the immutable prefixes list, and add the `archivist:compaction-migration` marker to the rkey prefix lists.

**Tech Stack:** Markdown

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-05-13

---

## Acceptance Criteria Coverage

This phase implements:

### compaction-session-scoping.AC4: Documentation is updated
- **compaction-session-scoping.AC4.1 Success:** CLAUDE.md lists `context:<sessionId>:<timestamp>` in rkey prefix documentation
- **compaction-session-scoping.AC4.2 Success:** CLAUDE.md lists `context:*` as an immutable prefix
- **compaction-session-scoping.AC4.3 Success:** CLAUDE.md no longer references `archive:<timestamp>` as a compaction rkey format

---

<!-- START_TASK_1 -->
### Task 1: Update rkey prefix list

**Verifies:** compaction-session-scoping.AC4.1, compaction-session-scoping.AC4.3

**Files:**
- Modify: `CLAUDE.md:98-109` (rkey prefix list under "### Documents & Memory")

**Implementation:**

In the rkey prefix list at `CLAUDE.md:93-109`, make these changes:

1. **Replace line 99** (`- \`archive:<timestamp>\` — context compaction snapshots`) with:
```
- `context:<sessionId>:<timestamp>` — session-scoped context compaction snapshots
```

2. **Add after the `archivist:ref-migration` entry** (after line 108):
```
- `archivist:compaction-migration` — marker for compaction archive migration idempotency
```

The resulting prefix list section (lines 93-110) should read:

```markdown
The agent's memory is a flat document store: `rkey → content`. Conventional rkey prefixes provide structure:
- `self` — agent identity (auto-loaded into system prompt every turn)
- `operator` — user preferences/context (fetched on demand)
- `skill:<name>` — reusable TypeScript skills
- `customtool:<name>` — user-created custom tools (hash-based approval)
- `task:<name>` — task state
- `context:<sessionId>:<timestamp>` — session-scoped context compaction snapshots
- `archive:session:<slug>:<datetime>` — archived conversation sessions (from session management)
- `ref:<name>` — reference documents (books, PDFs, etc.; migrated from `knowledge:*` and immutable)
- `ref:<name>:chunk:<i>` — chunked reference documents
- `knowledge:<name>` — semantic knowledge documents (user-ingested, mutable)
- `knowledge:<name>:chunk:<i>` — chunked knowledge documents
- `archivist:identity` — archivist identity document (seeded once on startup)
- `archivist:state` — archivist snapshot state (internal)
- `archivist:log` — append-only archivist run log
- `archivist:ref-migration` — marker for ref migration idempotency
- `archivist:compaction-migration` — marker for compaction archive migration idempotency
- `index:*` — semantic indices (future)
```

**Verification:**

Visually inspect the rkey prefix list. `archive:<timestamp>` should no longer appear. `context:<sessionId>:<timestamp>` and `archivist:compaction-migration` should be present.

**Commit:** `docs: update rkey prefix list for context: compaction prefix`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update compaction description

**Verifies:** compaction-session-scoping.AC4.1, compaction-session-scoping.AC4.3

**Files:**
- Modify: `CLAUDE.md:113` (compaction paragraph under "### Documents & Memory")

**Implementation:**

Replace the compaction description at line 113:

**Current:**
```
Context compaction (`src/agent/compaction.ts`) triggers when token estimates exceed `contextBudget × contextLimit`. It saves the current conversation as an `archive:<timestamp>` document, then rebuilds context from a summary of older context docs + the 3 most recent in full.
```

**New:**
```
Context compaction (`src/agent/compaction.ts`) triggers when token estimates exceed `contextBudget × contextLimit`. It saves the current conversation as a `context:<sessionId>:<timestamp>` document scoped to the current session, then rebuilds context from a summary of the session's older context docs + the 3 most recent in full. Each session (TUI UUID, Discord channel ID, or scheduler `task:<id>`) maintains its own compaction namespace, preventing cross-session contamination. When `sessionId` is not provided, compaction uses `"default"` as fallback.
```

**Verification:**

Visually inspect the paragraph. It should reference `context:<sessionId>:<timestamp>` and describe session scoping.

**Commit:** `docs: update compaction description for session scoping`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update immutable prefixes and archivist rkey documentation

**Verifies:** compaction-session-scoping.AC4.2

**Files:**
- Modify: `CLAUDE.md:159-171` (archivist rkey prefixes and immutability boundaries)

**Implementation:**

1. In the **"New rkey Prefixes"** section (lines 159-165), add after the `archivist:ref-migration` entry (after line 163):

```
- `archivist:compaction-migration` — Marker document indicating compaction archive migration has run (one-time idempotency).
- `context:*` — Session-scoped compaction snapshots. Transient — archivist never modifies.
```

2. In the **"Immutability Boundaries"** section (lines 167-171), update the count from "three" to "four" and add `context:*`:

**Current (lines 167-171):**
```
**Immutability Boundaries:**
The archivist respects three immutable prefixes and never modifies documents within them:
- `ref:*` — Reference materials (books, PDFs). Migrated once, updated only by ingest tool with `reference` intent.
- `skill:*` — Reusable skills. User-controlled, require grants.
- `customtool:*` — Custom tools. User-controlled, require hash-based approval.
```

**New:**
```
**Immutability Boundaries:**
The archivist respects four immutable prefixes and never modifies documents within them:
- `ref:*` — Reference materials (books, PDFs). Migrated once, updated only by ingest tool with `reference` intent.
- `skill:*` — Reusable skills. User-controlled, require grants.
- `customtool:*` — Custom tools. User-controlled, require hash-based approval.
- `context:*` — Session-scoped compaction snapshots. Transient context managed by compaction, not durable knowledge.
```

**Verification:**

Visually inspect both sections. `context:*` should appear in both the rkey prefixes list and the immutability boundaries list.

**Commit:** `docs: add context: to immutable prefixes and archivist rkey documentation`
<!-- END_TASK_3 -->
