// pattern: Imperative Shell (test) — exercises CustomToolManager against a real in-memory store

import { describe, expect, test, beforeEach } from 'bun:test';
import { createStore, type Store } from '../store/store.ts';
import {
  createCustomToolManager,
  type CustomToolManager,
} from './custom-tool-manager.ts';

describe('CustomToolManager', () => {
  let store: Store;
  let manager: CustomToolManager;

  beforeEach(() => {
    store = createStore(':memory:');
    manager = createCustomToolManager(store);
  });

  test('GH10.AC1.1: saveTool stores new tool as unapproved', () => {
    const result = manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: {},
      code: 'output("hi")',
    });

    expect(result.approved).toBe(false);
    expect(result.name).toBe('test-tool');
    expect(result.codeHash).toBeDefined();

    const fetched = manager.getTool('test-tool');
    expect(fetched).toBeDefined();
    expect(fetched!.approved).toBe(false);
    expect(fetched!.code).toBe('output("hi")');
  });

  test('saveTool persists tool as customtool:<name> document', () => {
    manager.saveTool({
      name: 'doc-key-tool',
      description: 'A test',
      parameters: {},
      code: 'output("hi")',
    });

    const doc = store.docGet('customtool:doc-key-tool');
    expect(doc).not.toBeNull();
    const parsed = JSON.parse(doc!.content);
    expect(parsed.name).toBe('doc-key-tool');
    expect(parsed.approved).toBe(false);
  });

  test('GH10.AC1.2: changing code auto-revokes approval', () => {
    manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: {},
      code: 'output("first")',
    });
    manager.approveTool('test-tool');
    expect(manager.getTool('test-tool')?.approved).toBe(true);

    const result = manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: {},
      code: 'output("changed")',
    });

    expect(result.approved).toBe(false);
    expect(manager.getTool('test-tool')?.approved).toBe(false);
  });

  test('GH10.AC1.3: unchanged code preserves approval', () => {
    manager.saveTool({
      name: 'test-tool',
      description: 'Original description',
      parameters: { foo: 'bar' },
      code: 'output("hi")',
    });
    manager.approveTool('test-tool');

    const result = manager.saveTool({
      name: 'test-tool',
      description: 'Different description',
      parameters: { foo: 'bar' },
      code: 'output("hi")',
    });

    expect(result.approved).toBe(true);
    expect(result.description).toBe('Different description');
    expect(manager.getTool('test-tool')?.approved).toBe(true);
  });

  test('changing parameters but not code triggers auto-revoke', () => {
    manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: { a: 1 },
      code: 'output("hi")',
    });
    manager.approveTool('test-tool');

    const result = manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: { a: 2 },
      code: 'output("hi")',
    });

    expect(result.approved).toBe(false);
  });

  test('GH10.AC4.1: approveTool sets approved = true', () => {
    manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: {},
      code: 'output("hi")',
    });

    expect(manager.approveTool('test-tool')).toBe(true);
    expect(manager.getTool('test-tool')?.approved).toBe(true);
  });

  test('approveTool on nonexistent tool returns false', () => {
    expect(manager.approveTool('nonexistent')).toBe(false);
  });

  test('revokeTool sets approved = false on an approved tool', () => {
    manager.saveTool({
      name: 'test-tool',
      description: 'A test',
      parameters: {},
      code: 'output("hi")',
    });
    manager.approveTool('test-tool');
    expect(manager.getTool('test-tool')?.approved).toBe(true);

    expect(manager.revokeTool('test-tool')).toBe(true);
    expect(manager.getTool('test-tool')?.approved).toBe(false);
  });

  test('revokeTool on nonexistent tool returns false', () => {
    expect(manager.revokeTool('nonexistent')).toBe(false);
  });

  test('GH10.AC7.1: getApprovedToolSummaries returns only approved tools', () => {
    manager.saveTool({
      name: 'approved-tool',
      description: 'I am approved',
      parameters: {},
      code: 'output(1)',
    });
    manager.saveTool({
      name: 'pending-tool',
      description: 'I am pending',
      parameters: {},
      code: 'output(2)',
    });
    manager.approveTool('approved-tool');

    const summaries = manager.getApprovedToolSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      name: 'approved-tool',
      description: 'I am approved',
    });
  });

  test('listTools returns all custom tools regardless of approval', () => {
    manager.saveTool({
      name: 'a', description: '', parameters: {}, code: 'output(1)',
    });
    manager.saveTool({
      name: 'b', description: '', parameters: {}, code: 'output(2)',
    });
    manager.approveTool('a');

    const all = manager.listTools();
    expect(all).toHaveLength(2);
    const names = all.map(t => t.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  test('getTool for nonexistent name returns undefined', () => {
    expect(manager.getTool('nonexistent')).toBeUndefined();
  });

  test('listTools ignores non-customtool documents', () => {
    store.docUpsert('skill:other', '// not a custom tool');
    store.docUpsert('operator', '# operator notes');
    manager.saveTool({
      name: 'real',
      description: 'real one',
      parameters: {},
      code: 'output(1)',
    });

    const tools = manager.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('real');
  });
});
