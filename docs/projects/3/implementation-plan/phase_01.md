# GH03: Multi-Tool Architecture — Phase 1: Tool Registry Extension

**Goal:** Extend the ToolRegistry to support a `mode` flag per tool entry, enabling selective exposure of tools as native API-level `tool_use` definitions vs sandbox-only stubs.

**Architecture:** Add a `ToolMode` type (`'sandbox' | 'native' | 'both'`) to the registry entry. Update `register()` to accept mode (default `'sandbox'` for backward compatibility). Add `generateToolDefinitions()` that returns definitions for native/both-mode tools. Filter existing `generateTypeScriptStubs()` to sandbox/both-mode tools. `generateToolDocumentation()` continues to document all tools regardless of mode.

**Tech Stack:** TypeScript, Bun

**Scope:** 4 phases from original design (phases 1-4)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH03.AC1: Registry supports mode per tool
- **GH03.AC1.1 Success:** Registry supports `mode: 'sandbox' | 'native' | 'both'` per tool
- **GH03.AC1.2 Success:** `generateToolDefinitions()` returns only native/both-mode tools
- **GH03.AC1.3 Success:** `generateTypeScriptStubs()` generates stubs for only sandbox/both-mode tools
- **GH03.AC1.4 Success:** `generateToolDocumentation()` documents all tools regardless of mode
- **GH03.AC1.5 Success:** Existing tools unaffected — all 8 remain sandbox-only

### GH03.AC9: Test registry mode filtering
- **GH03.AC9.1 Success:** Register native tool, verify it appears in `generateToolDefinitions()` but not in stubs

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add ToolMode type and update RegistryEntry

**Files:**
- Modify: `src/runtime/tool-registry.ts:9-18` (type definitions)

**Implementation:**

Add the `ToolMode` type and update `RegistryEntry` to include it. Export `ToolMode` since the agent loop will need it for type checking.

After the existing `ToolHandler` type (line 13), add:

```typescript
export type ToolMode = 'sandbox' | 'native' | 'both';
```

Update the `RegistryEntry` type (lines 15-18) to include mode:

```typescript
type RegistryEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
  mode: ToolMode;
};
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Type check passes (downstream code will have errors until Task 2 completes — that's expected within this subcomponent)

**Commit:** Do not commit yet — complete Task 2 first.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update register() signature and ToolRegistry type

**Files:**
- Modify: `src/runtime/tool-registry.ts:20-33` (ToolRegistry type)
- Modify: `src/runtime/tool-registry.ts:116-122` (register function implementation)

**Implementation:**

Update the `ToolRegistry` type's `register` method to accept an optional `mode` parameter:

```typescript
export type ToolRegistry = {
  register(
    name: string,
    definition: ToolDefinition,
    handler: ToolHandler,
    mode?: ToolMode,
  ): void;
  // ... rest unchanged
```

Add `generateToolDefinitions()` to the `ToolRegistry` type, after `execute`:

```typescript
  generateToolDefinitions(): ToolDefinition[];
```

Update the `register` function implementation to accept and store mode (defaulting to `'sandbox'`):

```typescript
function register(
  name: string,
  definition: ToolDefinition,
  handler: ToolHandler,
  mode: ToolMode = 'sandbox',
): void {
  entries.set(name, { definition, handler, mode });
}
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: Errors about missing `generateToolDefinitions` in return object (fixed in Task 3)

**Commit:** Do not commit yet — complete Task 3 first.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Implement generateToolDefinitions() and add mode filtering

**Files:**
- Modify: `src/runtime/tool-registry.ts:154-175` (generateTypeScriptStubs)
- Modify: `src/runtime/tool-registry.ts:181-209` (generateToolDocumentation)
- Modify: `src/runtime/tool-registry.ts:211-219` (return object)

**Implementation:**

Add the `generateToolDefinitions()` function inside `createToolRegistry()`, before the return statement. This returns `ToolDefinition[]` for tools with mode `'native'` or `'both'`:

```typescript
function generateToolDefinitions(): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  for (const [, entry] of entries) {
    if (entry.mode === 'native' || entry.mode === 'both') {
      definitions.push(entry.definition);
    }
  }
  return definitions;
}
```

Update `generateTypeScriptStubs()` to filter entries to only sandbox/both-mode tools. Change the loop at line 161 from:

```typescript
for (const [name, entry] of entries) {
```

to:

```typescript
for (const [name, entry] of entries) {
  if (entry.mode === 'native') continue;
```

`generateToolDocumentation()` requires NO changes — it already documents all entries, which is the desired behaviour.

Add `generateToolDefinitions` to the return object:

```typescript
return {
  register,
  get,
  list,
  execute,
  generateToolDefinitions,
  generateTypeScriptStubs,
  generateToolDocumentation,
};
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors. All existing callers of `register()` still work because `mode` defaults to `'sandbox'`.

**Commit:**
```bash
git add src/runtime/tool-registry.ts
git commit -m "feat(registry): add ToolMode and generateToolDefinitions for native tool support"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Write ToolRegistry mode filtering tests

**Verifies:** GH03.AC1.1, GH03.AC1.2, GH03.AC1.3, GH03.AC1.4, GH03.AC1.5, GH03.AC9.1

**Files:**
- Create: `src/runtime/tool-registry.test.ts`

**Implementation:**

Create the first test file in the project. Bun's test runner discovers `*.test.ts` files automatically. No configuration needed.

The test file should import `createToolRegistry` and exercise the mode filtering. Define a small helper to create a dummy `ToolDefinition` with a given name.

**Testing:**
Tests must verify each AC listed above:
- **GH03.AC1.1:** Register tools with each mode value (`'sandbox'`, `'native'`, `'both'`) — verify they are stored and retrievable via `get()`.
- **GH03.AC1.2:** Register one sandbox tool, one native tool, one both-mode tool. Call `generateToolDefinitions()` — verify it returns only the native and both-mode tools (not the sandbox-only tool).
- **GH03.AC1.3:** Same setup. Call `generateTypeScriptStubs()` — verify the output contains stub functions for sandbox and both-mode tools, but NOT for the native-only tool.
- **GH03.AC1.4:** Same setup. Call `generateToolDocumentation()` — verify all three tools appear in the output regardless of mode.
- **GH03.AC1.5:** Register a tool with no explicit mode (relies on default). Verify via `get()` that it has mode `'sandbox'`. Verify it appears in stubs and docs, but not in `generateToolDefinitions()`.
- **GH03.AC9.1:** Register a native-mode tool. Verify it appears in `generateToolDefinitions()`. Verify it does NOT appear in `generateTypeScriptStubs()` output.

Follow Bun test conventions: `import { describe, it, expect } from 'bun:test'`.

**Verification:**
Run: `bun test src/runtime/tool-registry.test.ts`
Expected: All tests pass

**Commit:**
```bash
git add src/runtime/tool-registry.test.ts
git commit -m "test(registry): add mode filtering tests for ToolRegistry"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Verify existing tools are unaffected

**Verifies:** GH03.AC1.5

**Implementation:**

This is a manual verification step. The existing `createAgentTools()` in `src/agent/tools.ts` calls `registry.register(name, definition, handler)` for all 8 tools without a `mode` argument. Since `mode` defaults to `'sandbox'`, all existing tools remain sandbox-only.

Verify by reading `src/agent/tools.ts` and confirming none of the 8 `register()` calls pass a 4th argument. Confirm that `bunx tsc --noEmit` passes with zero errors.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No errors. All 8 existing tool registrations compile without changes.

Run: `bun test`
Expected: All tests pass (including the new ones from Task 4).

**Commit:** No commit needed — this is a verification-only step.
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
