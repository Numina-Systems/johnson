# Human Test Plan: File Ingestion

## Prerequisites
- `bun test` passing (60 tests, 0 failures)
- Agent running via `bun start` (TUI mode)
- A workspace directory with test files available
- Optionally: Discord bot running for cross-interface verification

## Phase 1: Basic File Reading (TUI)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start agent with `bun start` | TUI loads, chat screen accessible |
| 2 | Create a file `~/test-workspace/hello.md` containing `# Hello\nWorld` | File exists on disk |
| 3 | In chat, ask agent to ingest `hello.md` for context | Agent calls `ingest_file` tool, displays file content in response |
| 4 | Ask agent to ingest `../../etc/passwd` | Agent reports security error about path traversal; no file content shown |
| 5 | Ask agent to ingest a non-existent file `ghost.md` | Agent reports file not found and suggests available files |

## Phase 2: Memory Intent (TUI)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ask agent to ingest a small file with memory intent (e.g., "remember what's in preferences.md") | Agent confirms content appended to self document |
| 2 | In subsequent messages, verify agent recalls the ingested content without re-reading the file | Agent references facts from the ingested file naturally |
| 3 | Navigate to System Prompt screen (`p` key) and verify `<!-- from: preferences.md -->` separator is visible in the self document section | Separator and content present |

## Phase 3: Knowledge Intent (TUI)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ask agent to ingest a large markdown file (~10KB+) with knowledge intent | Agent reports successful storage with chunk count |
| 2 | Ask agent a question that would require information from the ingested file | Agent retrieves relevant chunks via doc_search and answers accurately |
| 3 | Modify the source file and re-ingest with knowledge intent | Agent reports successful update; old content no longer retrievable |

## Phase 4: Context Intent with Large Files (TUI)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ask agent to ingest a large file (~20KB) for context | Agent returns a summarised roll-up (not the full file content) |
| 2 | Ask a follow-up question about the file content | Agent can answer from the summary provided in the tool result |
| 3 | Verify no `knowledge:*` documents were created (ask agent to list documents) | No persistence from context-intent ingest |

## End-to-End: Full Lifecycle

**Purpose:** Validate the complete ingest-retrieve-update cycle works as a user would experience it.

1. Create `~/test-workspace/project-notes.md` with 3 sections totaling ~15KB
2. Ingest with knowledge intent -- verify agent confirms chunk count
3. Ask agent "what does project-notes say about [topic from section 2]?" -- verify accurate retrieval
4. Edit `project-notes.md` to remove section 2 entirely (making it shorter)
5. Re-ingest with knowledge intent -- verify new chunk count is lower
6. Ask about the removed topic -- verify agent no longer finds the old content
7. Ask about remaining content -- verify still retrievable

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC6.1: Tool works identically from TUI and Discord | No automated cross-interface test | 1. Start TUI and Discord bot. 2. From TUI, ingest `test.md` with context intent. 3. From Discord DM, ingest same file. 4. Compare results. |
| Summary quality (subjective) | Sub-agent output quality requires human judgment | 1. Ingest a real-world document with knowledge intent. 2. Read stored summary. 3. Verify it captures essential points. |
| Error message clarity | UX quality requires human assessment | 1. Trigger each error path. 2. Assess whether messages help the agent self-correct. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `resolves @/notes.md...` | Phase 1, Step 3 |
| AC1.2 | `resolves sub/dir/file.md` | -- |
| AC1.3 | `rejects path traversal` | Phase 1, Step 4 |
| AC1.4 | `rejects absolute path` | Phase 1, Step 4 |
| AC1.5 | `returns error JSON when file does not exist` | Phase 1, Step 5 |
| AC1.6 | `detects binary file` | Human Verification |
| AC1.7 | `rejects file exceeding 400KB` | Human Verification |
| AC2.1 | `appends file content to self document` | Phase 2, Steps 1-2 |
| AC2.2 | `large file with memory intent appends summarised content` | Phase 2, Step 1 (large file) |
| AC2.3 | `includes <!-- from: filename --> separator` | Phase 2, Step 3 |
| AC3.1 | `stores file as knowledge:<name>` | Phase 3, Step 1 |
| AC3.2 | `stores summary + chunk documents` | Phase 3, Step 1 |
| AC3.3 | `summary includes metadata` | -- |
| AC3.4 | `re-ingesting file overwrites` | Phase 3, Step 3 |
| AC3.5 | `re-ingesting with fewer chunks deletes stale` | End-to-End, Steps 4-6 |
| AC3.6 | `knowledge document retrievable via docSearch` | Phase 3, Step 2 |
| AC4.1 | `returns file content, nothing persisted` | Phase 4, Step 3 |
| AC4.2 | `large file context returns roll-up` | Phase 4, Step 1 |
| AC5.1-5.3 | Multiple chunking unit tests | -- |
| AC5.4 | `subAgent called N+1 times` | Phase 4, Step 1 |
| AC5.5 | `subAgent failure falls back to truncation` | -- |
| AC6.1 | N/A | Human Verification |
| AC6.2 | `calls embedding.embed()` tests | -- |
| AC6.3 | `includes tokenEstimate` | Phase 1, Step 3 |
