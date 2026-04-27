// pattern: Imperative Shell (test) — full createAgentTools wiring with real CustomToolManager

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore, type Store } from '../store/store.ts';
import { createAgentTools } from '../agent/tools.ts';
import { createCustomToolManager, type CustomToolManager } from './custom-tool-manager.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { CodeRuntime, ExecutionResult } from '../runtime/types.ts';
import type { ModelProvider } from '../model/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

type RuntimeCall = { code: string; env?: Record<string, string> };

describe('GH10: custom tools end-to-end through createAgentTools', () => {
  let tmpDir: string;
  let personaPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gh10-integration-'));
    personaPath = join(tmpDir, 'persona.md');
    writeFileSync(personaPath, '# Test\n');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  let store: Store;
  let customTools: CustomToolManager;
  let runtimeCalls: RuntimeCall[];
  let runtime: CodeRuntime;
  let secrets: SecretManager;
  let deps: AgentDependencies;

  beforeEach(() => {
    store = createStore(':memory:');
    customTools = createCustomToolManager(store);
    runtimeCalls = [];
    runtime = {
      execute: async (code, env) => {
        runtimeCalls.push({ code, env });
        return { success: true, output: 'tool output', error: null, duration_ms: 10 };
      },
    };
    secrets = {
      listKeys: () => ['MY_SECRET'],
      get: (k) => k === 'MY_SECRET' ? 'secret-val' : undefined,
      set: async () => {},
      remove: async () => {},
      resolve: (keys) => {
        const env: Record<string, string> = {};
        for (const k of keys) if (k === 'MY_SECRET') env[k] = 'secret-val';
        return env;
      },
    };

    const mockModel: ModelProvider = {
      complete: async () => { throw new Error('not used in these tests'); },
    };

    deps = {
      model: mockModel,
      runtime,
      config: {
        model: 'test',
        maxTokens: 1000,
        maxToolRounds: 5,
        contextBudget: 0.8,
        contextLimit: 100_000,
        modelTimeout: 30_000,
        timezone: 'UTC',
      },
      personaPath,
      store,
      secrets,
      customTools,
    };
  });

  test('GH10.AC9.1: create tool, verify stored unapproved', async () => {
    const registry = createAgentTools(deps, {});

    const createResult = await registry.execute('create_custom_tool', {
      name: 'my-tool',
      description: 'a test tool',
      parameters: {},
      code: 'output("hi")',
    });
    expect(createResult).toContain('created');
    expect(createResult).toContain('Pending approval');

    const stored = customTools.getTool('my-tool');
    expect(stored).toBeDefined();
    expect(stored!.approved).toBe(false);

    const listResult = await registry.execute('list_custom_tools', {});
    expect(listResult).toContain('my-tool');
    expect(listResult).toContain('pending approval');
  });

  test('GH10.AC10.1: approve, change code, verify auto-revoked', async () => {
    const registry = createAgentTools(deps, {});

    await registry.execute('create_custom_tool', {
      name: 'my-tool',
      description: 'a tool',
      parameters: {},
      code: 'output("first")',
    });
    customTools.approveTool('my-tool');
    expect(customTools.getTool('my-tool')!.approved).toBe(true);

    const updateResult = await registry.execute('create_custom_tool', {
      name: 'my-tool',
      description: 'a tool',
      parameters: {},
      code: 'output("changed")',
    });
    expect(updateResult).toContain('revoked');

    expect(customTools.getTool('my-tool')!.approved).toBe(false);

    const listResult = await registry.execute('list_custom_tools', {});
    expect(listResult).toContain('pending approval');
  });

  test('GH10.AC11.1: call approved tool with secrets injected', async () => {
    const registry = createAgentTools(deps, {});

    await registry.execute('create_custom_tool', {
      name: 'my-tool',
      description: 'a tool',
      parameters: {},
      code: 'output(__params.x)',
      secrets: ['MY_SECRET'],
    });
    customTools.approveTool('my-tool');

    const callResult = await registry.execute('call_custom_tool', {
      name: 'my-tool',
      params: { x: 1 },
    });

    expect(callResult).toBe('tool output');
    expect(runtimeCalls).toHaveLength(1);
    expect(runtimeCalls[0]!.code).toStartWith('const __params = {"x":1};');
    expect(runtimeCalls[0]!.code).toContain('output(__params.x)');
    expect(runtimeCalls[0]!.env).toEqual({ MY_SECRET: 'secret-val' });
  });

  test('GH10.AC12.1: call unapproved tool returns clear error', async () => {
    const registry = createAgentTools(deps, {});

    await registry.execute('create_custom_tool', {
      name: 'my-tool',
      description: 'a tool',
      parameters: {},
      code: 'output(1)',
    });

    await expect(registry.execute('call_custom_tool', { name: 'my-tool' }))
      .rejects.toThrow(/not approved/);
  });

  test('call_custom_tool for nonexistent tool throws meaningful error', async () => {
    const registry = createAgentTools(deps, {});

    await expect(registry.execute('call_custom_tool', { name: 'missing' }))
      .rejects.toThrow(/not found/);
  });

  test('custom tools appear in TypeScript stubs (sandbox dispatch path)', () => {
    const registry = createAgentTools(deps, {});
    const stubs = registry.generateTypeScriptStubs();
    expect(stubs).toContain('create_custom_tool');
    expect(stubs).toContain('list_custom_tools');
    expect(stubs).toContain('call_custom_tool');
  });

  test('custom tools appear in tool documentation', () => {
    const registry = createAgentTools(deps, {});
    const docs = registry.generateToolDocumentation();
    expect(docs).toContain('create_custom_tool');
    expect(docs).toContain('list_custom_tools');
    expect(docs).toContain('call_custom_tool');
  });

  test('custom tools NOT registered when deps.customTools is missing', () => {
    const depsWithoutCustomTools: AgentDependencies = {
      ...deps,
      customTools: undefined,
    };
    const registry = createAgentTools(depsWithoutCustomTools, {});

    const names = registry.list().map(t => t.name);
    expect(names).not.toContain('create_custom_tool');
    expect(names).not.toContain('list_custom_tools');
    expect(names).not.toContain('call_custom_tool');
  });
});
