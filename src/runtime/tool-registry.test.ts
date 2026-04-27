// pattern: Imperative Shell (test) — exercises registry with synthetic tools

import { describe, expect, it } from 'bun:test';
import { createToolRegistry } from './tool-registry.ts';
import type { ToolDefinition } from '../model/types.ts';
import type { ToolHandler } from './tool-registry.ts';

function makeDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Description for ${name}`,
    input_schema: {
      type: 'object',
      properties: {
        arg: { type: 'string', description: 'an argument' },
      },
      required: ['arg'],
    },
  };
}

const noopHandler: ToolHandler = async () => null;

describe('ToolRegistry mode filtering', () => {
  it('GH03.AC1.1: stores tools registered with each mode value', () => {
    const reg = createToolRegistry();
    reg.register('sand_tool', makeDefinition('sand_tool'), noopHandler, 'sandbox');
    reg.register('nat_tool', makeDefinition('nat_tool'), noopHandler, 'native');
    reg.register('both_tool', makeDefinition('both_tool'), noopHandler, 'both');

    expect(reg.get('sand_tool')).toBeDefined();
    expect(reg.get('nat_tool')).toBeDefined();
    expect(reg.get('both_tool')).toBeDefined();
  });

  it('GH03.AC1.2: generateToolDefinitions returns only native and both-mode tools', () => {
    const reg = createToolRegistry();
    reg.register('sand_tool', makeDefinition('sand_tool'), noopHandler, 'sandbox');
    reg.register('nat_tool', makeDefinition('nat_tool'), noopHandler, 'native');
    reg.register('both_tool', makeDefinition('both_tool'), noopHandler, 'both');

    const defs = reg.generateToolDefinitions();
    const names = defs.map((d) => d.name);

    expect(names).toContain('nat_tool');
    expect(names).toContain('both_tool');
    expect(names).not.toContain('sand_tool');
    expect(defs.length).toBe(2);
  });

  it('GH03.AC1.3: generateTypeScriptStubs emits stubs only for sandbox and both-mode tools', () => {
    const reg = createToolRegistry();
    reg.register('sand_tool', makeDefinition('sand_tool'), noopHandler, 'sandbox');
    reg.register('nat_tool', makeDefinition('nat_tool'), noopHandler, 'native');
    reg.register('both_tool', makeDefinition('both_tool'), noopHandler, 'both');

    const stubs = reg.generateTypeScriptStubs();

    expect(stubs).toContain('export async function sand_tool');
    expect(stubs).toContain('export async function both_tool');
    expect(stubs).not.toContain('export async function nat_tool');
  });

  it('GH03.AC1.4: generateToolDocumentation documents all tools regardless of mode', () => {
    const reg = createToolRegistry();
    reg.register('sand_tool', makeDefinition('sand_tool'), noopHandler, 'sandbox');
    reg.register('nat_tool', makeDefinition('nat_tool'), noopHandler, 'native');
    reg.register('both_tool', makeDefinition('both_tool'), noopHandler, 'both');

    const docs = reg.generateToolDocumentation();

    expect(docs).toContain('sand_tool');
    expect(docs).toContain('nat_tool');
    expect(docs).toContain('both_tool');
    expect(docs).toContain('tools.sand_tool');
    expect(docs).toContain('Description for sand_tool');
    expect(docs).toContain('Description for nat_tool');
    expect(docs).toContain('Description for both_tool');
  });

  it('GH03.AC1.5: register() without mode defaults to sandbox', () => {
    const reg = createToolRegistry();
    reg.register('default_tool', makeDefinition('default_tool'), noopHandler);

    const stubs = reg.generateTypeScriptStubs();
    const docs = reg.generateToolDocumentation();
    const defs = reg.generateToolDefinitions();

    expect(stubs).toContain('export async function default_tool');
    expect(docs).toContain('tools.default_tool');
    expect(defs.map((d) => d.name)).not.toContain('default_tool');
  });

  it('GH03.AC9.1: native tool appears in definitions but not in stubs', () => {
    const reg = createToolRegistry();
    reg.register('only_native', makeDefinition('only_native'), noopHandler, 'native');

    const defs = reg.generateToolDefinitions();
    const stubs = reg.generateTypeScriptStubs();

    expect(defs.map((d) => d.name)).toContain('only_native');
    expect(stubs).not.toContain('export async function only_native');
  });
});
