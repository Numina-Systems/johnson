# Issue 001: Compaction archive contamination across sessions

**Severity:** High — correctness bug that compounds silently  
**Component:** `src/agent/compaction.ts`

## Problem

`listContextDocs()` uses `rkey.startsWith('archive:')` with no session scoping. All sessions share the same global `archive:*` pool. When compaction fires in Session A, it pulls in archives from Session B, Session C, and any archived sessions — polluting context with irrelevant history.

This gets worse over time as the archive pool grows.

## Expected Behaviour

Compaction should only summarize archives belonging to the current session.

## Proposed Fix

- Scope compaction rkeys to include session ID: `context:<sessionId>:<timestamp>`
- Update `listContextDocs()` to filter by session ID
- Migrate existing `archive:*` compaction documents (distinct from `archive:session:*` which are session management archives)
