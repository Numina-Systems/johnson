# #12 — Dynamic System Prompt Provider

**Issue:** https://github.com/Numina-Systems/johnson/issues/12
**Wave:** 1 (no hard dependencies)

## Current State

`_chatImpl` builds the system prompt inline every call: reads persona file, loads core memory from store, lists skill names, generates tool docs, calls `buildSystemPrompt()`. This works, but new features (#10 custom tools, #14 secrets) need to inject their own context into the prompt, and doing so means modifying `_chatImpl` each time.

## Design

### The Problem

The prompt-building logic is hardcoded in the agent loop. Every new feature that wants to contribute context to the system prompt (custom tool list, secret names, active task summaries, time-of-day context) requires editing `src/agent/agent.ts`.

### The Solution

Extract prompt building into a callback on `AgentDependencies` so the wiring layer (`src/index.ts`) owns what goes into the prompt. The agent loop just calls the provider.

### Provider Signature

Add to `AgentDependencies`:

```typescript
systemPromptProvider?: () => Promise<string>;
```

Fully self-contained — the provider closure captures everything it needs (store, persona path, secrets, custom tool manager, etc.) from the wiring layer. The agent loop doesn't need to know what data sources feed the prompt.

### Agent Loop Changes

In `_chatImpl`, replace the inline prompt-building block (lines 96-106) with:

```typescript
let systemPrompt: string;
if (deps.systemPromptProvider) {
  try {
    systemPrompt = await deps.systemPromptProvider();
    cachedSystemPrompt = systemPrompt;
  } catch (err) {
    process.stderr.write(`[agent] system prompt provider failed, using cached: ${err}\n`);
    systemPrompt = cachedSystemPrompt;
  }
} else {
  // existing inline logic as fallback — preserves behaviour if no provider set
  const persona = await Bun.file(deps.personaPath).text();
  const coreMemory = loadCoreMemoryFromStore(deps.store);
  // ... same as current code
  systemPrompt = buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, deps.config.timezone);
}
```

Cache the last successful prompt in a closure variable `let cachedSystemPrompt = ''` so provider failures degrade gracefully.

### Tool Docs

The tool registry is recreated fresh each `chat()` call (line 86) because it depends on per-call context (ChatContext). The provider needs fresh tool docs too.

Two options:
1. The provider receives `toolDocs` as a parameter — means the agent loop still owns registry creation
2. The provider creates the registry itself — fully self-contained but duplicates registry creation

**Go with option 1.** The agent loop already creates the registry for sandbox stub generation. Pass the tool docs to the provider:

```typescript
systemPromptProvider?: (toolDocs: string) => Promise<string>;
```

Wait — this contradicts "fully self-contained." But the registry *must* be created in `_chatImpl` because it writes sandbox stubs. So the provider can't own it. The pragmatic answer: the provider signature is `(toolDocs: string) => Promise<string>`, and the agent loop passes in the fresh tool docs after creating the registry.

Actually, simplify further: the agent loop creates the registry, generates tool docs, then calls the provider. The provider's only job is assembling everything *else* (persona, memory, skills, secrets, custom tools) and combining it with the tool docs it receives. This keeps registry creation in one place.

### Wiring in `src/index.ts`

```typescript
const systemPromptProvider = async (toolDocs: string): Promise<string> => {
  const persona = await Bun.file(PERSONA_PATH).text();
  const coreMemory = loadCoreMemoryFromStore(store);
  const allDocs = store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  // Future: add custom tool names, secret names, etc.
  return buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, config.agent.timezone);
};
```

This is the same logic that's currently inline in `_chatImpl`, just extracted. New features extend this function — not agent.ts.

## Files Touched

- `src/agent/types.ts` — add `systemPromptProvider?: (toolDocs: string) => Promise<string>` to `AgentDependencies`
- `src/agent/agent.ts` — replace inline prompt building with provider call + fallback + cache
- `src/index.ts` — create provider function, pass to agent deps

## Acceptance Criteria

1. Provider receives `toolDocs` and returns the complete system prompt
2. Provider failure falls back to cached last-good prompt with stderr warning
3. Existing behaviour preserved when no provider is set (inline fallback)
4. `src/index.ts` wires a default provider that replicates current inline logic
5. New features (#10, #14 TUI integration) can extend the provider without touching agent.ts
6. Test: provider that throws → verify fallback to cached prompt
7. Test: provider returns custom prompt → verify it's used in model call
