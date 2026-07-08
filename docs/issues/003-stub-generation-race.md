# Issue 003: Deno tool stub generation race condition

**Severity:** Medium — concurrency bug  
**Component:** `src/agent/agent.ts`, `src/runtime/deno/tools.ts`

## Problem

`chat()` regenerates `src/runtime/deno/tools.ts` on every call. Multiple agent instances (Discord channels, TUI) share the same source directory. Concurrent `chat()` calls race to overwrite the same file, risking stale or corrupted stubs.

Also a code smell: generated code lives in `src/`.

## Expected Behaviour

Each execution should have isolated tool stubs. Generated code should not live in the source tree.

## Proposed Fix

- Write generated stubs to a unique temporary directory per execution (e.g., `os.tmpdir()` + execution ID)
- Or use Deno's ability to run from a data URL / inline module
- Remove `src/runtime/deno/tools.ts` from the source tree
