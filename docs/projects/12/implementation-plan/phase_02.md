# GH12: Dynamic System Prompt Provider - Phase 2

**Goal:** Wire a default system prompt provider in the application entry point and add tests proving provider usage, fallback behaviour, and inline preservation.

**Architecture:** The provider closure in `src/index.ts` captures shared dependencies (store, persona path, config) and replicates the logic previously inlined in the agent loop. Tests use mock dependencies to verify all three code paths: provider success, provider failure with fallback, and no provider set.

**Tech Stack:** TypeScript (Bun runtime, `bun:test`), strict mode

**Scope:** 2 phases from original design (this is phase 2 of 2)

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH12.AC4: src/index.ts wires a default provider that replicates current inline logic
- **GH12.AC4.1 Success:** The `systemPromptProvider` field in `agentDeps` is set to a function that calls `buildSystemPrompt` with fresh data from the store, persona file, and config

### GH12.AC5: New features (#10, #14 TUI integration) can extend the provider without touching agent.ts
- **GH12.AC5.1 Success:** The provider function is defined in `src/index.ts` where future features can add context (custom tool names, secret names, etc.) without modifying `src/agent/agent.ts`

### GH12.AC6: Test: provider that throws -> verify fallback to cached prompt
- **GH12.AC6.1 Test:** A test constructs an agent with a provider that throws, calls chat twice (first with a working provider to populate cache, then with a throwing provider), and verifies the cached prompt is used on the second call

### GH12.AC7: Test: provider returns custom prompt -> verify it's used in model call
- **GH12.AC7.1 Test:** A test constructs an agent with a provider returning a known string, calls chat, and verifies the model's `complete()` was called with that string as the `system` parameter

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Wire default systemPromptProvider in src/index.ts

**Verifies:** GH12.AC4.1, GH12.AC5.1

**Files:**
- Modify: `src/index.ts` (lines 77-94, the `agentDeps` object literal)

**Implementation:**

Add an import for `buildSystemPrompt` and `loadCoreMemoryFromStore` from `./agent/context.ts` at the top of the file, alongside the existing imports.

Add this import line after the existing agent imports (around line 21):

```typescript
import { buildSystemPrompt, loadCoreMemoryFromStore } from './agent/context.ts';
```

Then define the provider function before the `agentDeps` object (before line 77). The provider captures `PERSONA_PATH`, `store`, and `config` from the surrounding scope -- all of which are already defined at that point in `main()`:

```typescript
const systemPromptProvider = async (toolDocs: string): Promise<string> => {
  const persona = await Bun.file(PERSONA_PATH).text();
  const coreMemory = loadCoreMemoryFromStore(store);
  const allDocs = store.docList(500);
  const skillNames = allDocs.documents
    .filter(d => d.rkey.startsWith('skill:'))
    .map(d => d.rkey);
  return buildSystemPrompt(persona, coreMemory, skillNames, toolDocs, config.agent.timezone);
};
```

Then add `systemPromptProvider` to the `agentDeps` object. The full object becomes:

```typescript
const agentDeps: AgentDependencies = {
  model,
  runtime,
  config: {
    model: config.model.name,
    maxTokens: config.model.maxTokens,
    maxToolRounds: config.agent.maxToolRounds,
    contextBudget: config.agent.contextBudget,
    contextLimit: config.agent.contextLimit,
    modelTimeout: config.agent.modelTimeout,
    timezone: config.agent.timezone,
  },
  personaPath: PERSONA_PATH,
  embedding,
  get scheduler() { return scheduler; },
  store,
  secrets,
  systemPromptProvider,
};
```

**Why this is a `const` arrow function:** This is a closure passed as a value into the deps object, not a top-level named function. It captures `PERSONA_PATH`, `store`, and `config` from the `main()` scope. Arrow function is appropriate here.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH12 && npx tsc --noEmit`
Expected: Compiles without errors

**Commit:** `feat(GH12): wire default systemPromptProvider in index.ts`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add tests for system prompt provider behaviour

**Verifies:** GH12.AC6.1, GH12.AC7.1

**Files:**
- Create: `src/agent/agent.test.ts`

**Implementation:**

This project has no existing test files. The test runner is `bun test` (configured in `package.json`). Bun's test runner uses `bun:test` imports (`describe`, `test`, `expect`, `mock`). Test files are discovered by convention: `*.test.ts` files.

Create `src/agent/agent.test.ts` with two tests. Both tests need mock dependencies to construct an agent via `createAgent()`. The mock setup requires:

- A mock `ModelProvider` that returns a canned response with `stop_reason: 'end_turn'`
- A mock `CodeRuntime` (not exercised in these tests since the model won't emit tool_use)
- A mock `Store` with minimal implementations of `docGet`, `docList`, `docSearch`
- A real or minimal `AgentConfig`
- A `personaPath` pointing to a temp file (for the fallback path test)

**Mock factory:**

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createAgent } from './agent.ts';
import type { AgentDependencies } from './types.ts';
import type { ModelProvider, ModelResponse } from '../model/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { Store } from '../store/store.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockModelResponse(text: string): ModelResponse {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function createMockStore(): Store {
  return {
    docGet: () => null,
    docList: () => ({ documents: [] }),
    docUpsert: () => {},
    docDelete: () => false,
    docSearch: () => [],
    saveEmbedding: () => {},
    getEmbedding: () => null,
    getAllEmbeddings: () => [],
    getStaleEmbeddings: () => [],
    createSession: () => {},
    ensureSession: () => {},
    getSession: () => null,
    listSessions: () => [],
    updateSessionTitle: () => {},
    appendMessage: () => {},
    getMessages: () => [],
    deleteSession: () => {},
    saveGrant: () => {},
    getGrant: () => null,
    listGrants: () => [],
    close: () => {},
  } as unknown as Store;
}

function createMockRuntime(): CodeRuntime {
  return {
    execute: async () => ({ success: true, output: '' }),
  } as unknown as CodeRuntime;
}
```

**Test 1: Provider returns custom prompt -- verify it's used in model call (GH12.AC7.1)**

```typescript
describe('systemPromptProvider', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('uses provider return value as system prompt', async () => {
    const expectedPrompt = 'Custom system prompt from provider';
    let capturedSystem: string | undefined;

    const mockModel: ModelProvider = {
      complete: async (request) => {
        capturedSystem = request.system;
        return createMockModelResponse('ok');
      },
    };

    // personaPath needed for type but won't be read when provider is set
    const personaPath = join(tmpDir, 'persona.md');
    await writeFile(personaPath, 'unused persona');

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: createMockRuntime(),
      config: {
        model: 'test-model',
        maxTokens: 1000,
        maxToolRounds: 1,
        contextBudget: 100000,
        contextLimit: 50000,
        modelTimeout: 30000,
        timezone: 'UTC',
      },
      personaPath,
      store: createMockStore(),
      systemPromptProvider: async (_toolDocs: string) => expectedPrompt,
    };

    const agent = createAgent(deps);
    await agent.chat('hello');

    expect(capturedSystem).toBe(expectedPrompt);
  });
```

**Test 2: Provider that throws -- verify fallback to cached prompt (GH12.AC6.1)**

```typescript
  test('falls back to cached prompt when provider throws', async () => {
    const goodPrompt = 'Good system prompt';
    let callCount = 0;
    const capturedSystems: Array<string | undefined> = [];

    const mockModel: ModelProvider = {
      complete: async (request) => {
        capturedSystems.push(request.system);
        return createMockModelResponse('ok');
      },
    };

    const personaPath = join(tmpDir, 'persona.md');
    await writeFile(personaPath, 'unused persona');

    const provider = async (_toolDocs: string): Promise<string> => {
      callCount++;
      if (callCount === 1) return goodPrompt;
      throw new Error('provider broke');
    };

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: createMockRuntime(),
      config: {
        model: 'test-model',
        maxTokens: 1000,
        maxToolRounds: 1,
        contextBudget: 100000,
        contextLimit: 50000,
        modelTimeout: 30000,
        timezone: 'UTC',
      },
      personaPath,
      store: createMockStore(),
      systemPromptProvider: provider,
    };

    const agent = createAgent(deps);

    // First call: provider succeeds, caches the prompt
    await agent.chat('hello');
    expect(capturedSystems[0]).toBe(goodPrompt);

    // Second call: provider throws, should fall back to cached
    await agent.chat('hello again');
    expect(capturedSystems[1]).toBe(goodPrompt);
  });
});
```

**Note on the mock Store:** The `createMockStore()` cast through `unknown` is needed because `Store` has many methods and we only need a subset for these tests. The agent loop calls `docGet`, `docList`, and `docSearch` during prompt building (only in the fallback path). Since both tests use a provider, these methods aren't exercised in Test 1 or Test 2. The cast is documented and intentional for test ergonomics.

**Testing:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH12 && bun test`
Expected: Both tests pass

**Commit:** `test(GH12): add tests for systemPromptProvider usage and fallback`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
