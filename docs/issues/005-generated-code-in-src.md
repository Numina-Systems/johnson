# Issue 005: Generated tool stubs live in src/

**Severity:** Low — code smell  
**Component:** `src/runtime/deno/tools.ts`

## Problem

Generated Deno tool stubs are written directly into the source tree at `src/runtime/deno/tools.ts`. This complicates file watching, build pipelines, and git status.

## Note

Subsumes into Issue 003 — fixing the race condition naturally moves stubs out of `src/`.

## Proposed Fix

Addressed as part of Issue 003.
