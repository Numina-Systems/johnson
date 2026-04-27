// pattern: Imperative Shell (test) — exercises agent-facing custom tool handlers

import { describe, expect, test, beforeEach } from 'bun:test';
import { createStore, type Store } from '../store/store.ts';
import { createToolRegistry, type ToolRegistry } from '../runtime/tool-registry.ts';
import { createCustomToolManager, type CustomToolManager } from './custom-tool-manager.ts';
import { registerCustomTools } from './custom-tools.ts';
import type { CodeRuntime, ExecutionResult } from '../runtime/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

type RuntimeCall = {
  code: string;
  env?: Record<string, string>;
  argCount: number;
};

function makeMockRuntime(result: Partial<ExecutionResult> = {}): {
  runtime: CodeRuntime;
  calls: RuntimeCall[];
} {
  const calls: RuntimeCall[] = [];
  const runtime: CodeRuntime = {
    execute: async (code: string, env?: Record<string, string>, ...rest: unknown[]): Promise<ExecutionResult> => {
      calls.push({ code, env, argCount: rest.length + (env === undefined ? 1 : 2) });
      return {
        success: true,
        output: 'mock output',
        error: null,
        duration_ms: 0,
        ...result,
      };
    },
  };
  return { runtime, calls };
}

function makeMockSecrets(values: Record<string, string>): SecretManager {
  return {
    listKeys: () => Object.keys(values),
    get: (k) => values[k],
    set: async () => {},
    remove: async () => {},
    resolve: (keys) => {
      const env: Record<string, string> = {};
      for (const k of keys) {
        const v = values[k];
        if (v !== undefined) env[k] = v;
      }
      return env;
    },
  };
}

describe('registerCustomTools', () => {
  let store: Store;
  let manager: CustomToolManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    store = createStore(':memory:');
    manager = createCustomToolManager(store);
    registry = createToolRegistry();
  });

  test('registers all three tools', () => {
    const { runtime } = makeMockRuntime();
    registerCustomTools(registry, { customTools: manager, runtime });

    const names = registry.list().map(t => t.name).sort();
    expect(names).toEqual(['call_custom_tool', 'create_custom_tool', 'list_custom_tools']);
  });

  test('GH10.AC8.1: tools appear in TypeScript stubs (sandbox mode)', () => {
    const { runtime } = makeMockRuntime();
    registerCustomTools(registry, { customTools: manager, runtime });

    const stubs = registry.generateTypeScriptStubs();
    expect(stubs).toContain('create_custom_tool');
    expect(stubs).toContain('list_custom_tools');
    expect(stubs).toContain('call_custom_tool');
  });

  describe('create_custom_tool', () => {
    test('creates a new tool, returns "Pending approval" message', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      const result = await registry.execute('create_custom_tool', {
        name: 'my-tool',
        description: 'does stuff',
        parameters: {},
        code: 'output("hi")',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('created');
      expect(result).toContain('Pending approval');

      const stored = manager.getTool('my-tool');
      expect(stored).toBeDefined();
      expect(stored!.approved).toBe(false);
    });

    test('returns "approval revoked" message when updating an existing approved tool with new code', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      await registry.execute('create_custom_tool', {
        name: 'my-tool',
        description: 'v1',
        parameters: {},
        code: 'output(1)',
      });
      manager.approveTool('my-tool');

      const result = await registry.execute('create_custom_tool', {
        name: 'my-tool',
        description: 'v2',
        parameters: {},
        code: 'output(2)',
      });

      expect(result).toContain('revoked');
    });

    test('returns "still approved" message when updating with unchanged code', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      await registry.execute('create_custom_tool', {
        name: 'my-tool',
        description: 'v1',
        parameters: {},
        code: 'output(1)',
      });
      manager.approveTool('my-tool');

      const result = await registry.execute('create_custom_tool', {
        name: 'my-tool',
        description: 'v1 with new desc',
        parameters: {},
        code: 'output(1)',
      });

      expect(result).toContain('still approved');
    });

    test('rejects invalid tool names', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      await expect(registry.execute('create_custom_tool', {
        name: '123-bad',
        description: 'x',
        parameters: {},
        code: 'output(1)',
      })).rejects.toThrow(/Invalid tool name/);

      await expect(registry.execute('create_custom_tool', {
        name: 'UPPER',
        description: 'x',
        parameters: {},
        code: 'output(1)',
      })).rejects.toThrow(/Invalid tool name/);

      await expect(registry.execute('create_custom_tool', {
        name: 'has spaces',
        description: 'x',
        parameters: {},
        code: 'output(1)',
      })).rejects.toThrow(/Invalid tool name/);
    });

    test('requires non-empty description and code', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      await expect(registry.execute('create_custom_tool', {
        name: 'ok',
        description: '',
        parameters: {},
        code: 'output(1)',
      })).rejects.toThrow(/description/);

      await expect(registry.execute('create_custom_tool', {
        name: 'ok',
        description: 'has desc',
        parameters: {},
        code: '',
      })).rejects.toThrow(/code/);
    });
  });

  describe('list_custom_tools', () => {
    test('returns "(no custom tools)" when empty', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      const result = await registry.execute('list_custom_tools', {});
      expect(result).toBe('(no custom tools)');
    });

    test('shows approval status for each tool', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      manager.saveTool({ name: 'pending-one', description: 'p', parameters: {}, code: 'output(1)' });
      manager.saveTool({ name: 'approved-one', description: 'a', parameters: {}, code: 'output(2)' });
      manager.approveTool('approved-one');

      const result = await registry.execute('list_custom_tools', {});
      expect(typeof result).toBe('string');
      const text = result as string;
      expect(text).toContain('pending-one');
      expect(text).toContain('(pending approval)');
      expect(text).toContain('approved-one');
      expect(text).toContain('(approved)');
    });
  });

  describe('call_custom_tool', () => {
    test('GH10.AC5.1: throws clear error when tool is not approved', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      manager.saveTool({
        name: 'unapproved-tool',
        description: 'pending',
        parameters: {},
        code: 'output(1)',
      });

      await expect(registry.execute('call_custom_tool', { name: 'unapproved-tool' }))
        .rejects.toThrow(/not approved/);
    });

    test('throws when tool does not exist', async () => {
      const { runtime } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      await expect(registry.execute('call_custom_tool', { name: 'missing' }))
        .rejects.toThrow(/not found/);
    });

    test('GH10.AC6.1: executes approved tool via runtime with secrets injected', async () => {
      const { runtime, calls } = makeMockRuntime();
      const secrets = makeMockSecrets({ API_KEY: 'secret-value' });
      registerCustomTools(registry, { customTools: manager, runtime, secrets });

      manager.saveTool({
        name: 'test-tool',
        description: 'a tool',
        parameters: {},
        code: 'output(__params.query)',
        secrets: ['API_KEY'],
      });
      manager.approveTool('test-tool');

      const result = await registry.execute('call_custom_tool', {
        name: 'test-tool',
        params: { query: 'hello' },
      });

      expect(result).toBe('mock output');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.code).toStartWith('const __params = {"query":"hello"};');
      expect(calls[0]!.code).toContain('output(__params.query)');
      expect(calls[0]!.env).toEqual({ API_KEY: 'secret-value' });
    });

    test('passes undefined env when tool declares no secrets', async () => {
      const { runtime, calls } = makeMockRuntime();
      const secrets = makeMockSecrets({ API_KEY: 'secret-value' });
      registerCustomTools(registry, { customTools: manager, runtime, secrets });

      manager.saveTool({
        name: 'no-secrets',
        description: 'a tool',
        parameters: {},
        code: 'output(1)',
      });
      manager.approveTool('no-secrets');

      await registry.execute('call_custom_tool', { name: 'no-secrets' });

      expect(calls[0]!.env).toBeUndefined();
    });

    test('throws when runtime returns success: false', async () => {
      const { runtime } = makeMockRuntime({ success: false, error: 'boom', output: 'partial' });
      registerCustomTools(registry, { customTools: manager, runtime });

      manager.saveTool({
        name: 'failing',
        description: 'a tool',
        parameters: {},
        code: 'throw new Error("boom")',
      });
      manager.approveTool('failing');

      await expect(registry.execute('call_custom_tool', { name: 'failing' }))
        .rejects.toThrow(/boom/);
    });

    test('does NOT pass onToolCall to runtime.execute (no privilege escalation)', async () => {
      const { runtime, calls } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      manager.saveTool({
        name: 'iso-tool',
        description: 'a tool',
        parameters: {},
        code: 'output(1)',
      });
      manager.approveTool('iso-tool');

      await registry.execute('call_custom_tool', { name: 'iso-tool' });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.argCount).toBeLessThanOrEqual(2);
    });

    test('uses empty params when none provided', async () => {
      const { runtime, calls } = makeMockRuntime();
      registerCustomTools(registry, { customTools: manager, runtime });

      manager.saveTool({
        name: 'no-params',
        description: 'a tool',
        parameters: {},
        code: 'output(1)',
      });
      manager.approveTool('no-params');

      await registry.execute('call_custom_tool', { name: 'no-params' });

      expect(calls[0]!.code).toStartWith('const __params = {};');
    });
  });
});
