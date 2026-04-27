// pattern: Imperative Shell (test) — exercises summarize tool against a mock SubAgentLLM

import { describe, expect, test } from 'bun:test';
import { createToolRegistry } from '../runtime/tool-registry.ts';
import { registerSummarizeTools } from './summarize.ts';
import type { AgentDependencies } from '../agent/types.ts';

type Captured = {
  prompt: string;
  system: string;
  callCount: number;
};

function makeMockSubAgent(returnValue: string = 'Mock summary result.') {
  const captured: Captured = { prompt: '', system: '', callCount: 0 };
  const subAgent = {
    async complete(prompt: string, system?: string): Promise<string> {
      captured.prompt = prompt;
      captured.system = system ?? '';
      captured.callCount += 1;
      return returnValue;
    },
  };
  return { captured, subAgent };
}

function setupRegistry(subAgent?: { complete(prompt: string, system?: string): Promise<string> }) {
  const registry = createToolRegistry();
  const deps = { subAgent } as unknown as AgentDependencies;
  registerSummarizeTools(registry, deps);
  return registry;
}

describe('summarize tool', () => {
  test('GH08.AC1.1: sends text to sub-agent with summarization system prompt', async () => {
    const { captured, subAgent } = makeMockSubAgent('A short summary.');
    const registry = setupRegistry(subAgent);

    const result = await registry.execute('summarize', { text: 'Some content to summarize' });

    expect(captured.callCount).toBe(1);
    expect(captured.system).toBe(
      'You are a precise summarization assistant. Preserve key facts, names, and numbers. Do not add information not present in the source text.',
    );
    expect(captured.prompt).toContain('Some content to summarize');
    expect(result).toEqual({ summary: 'A short summary.' });
  });

  test('GH08.AC2.1: input is truncated at 100k chars', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    const oversized = 'x'.repeat(200_000);
    await registry.execute('summarize', { text: oversized });

    expect(captured.prompt.length).toBeLessThan(100_200);
    expect(captured.prompt).toContain('x'.repeat(100_000));
    expect(captured.prompt).not.toContain('x'.repeat(100_001));
  });

  test('GH08.AC3.1: max_length="short" maps to 2-3 sentence guidance', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', { text: 'test', max_length: 'short' });

    expect(captured.prompt).toContain('Respond in 2-3 sentences.');
  });

  test('GH08.AC3.1: max_length="medium" maps to 1-2 paragraph guidance', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', { text: 'test', max_length: 'medium' });

    expect(captured.prompt).toContain('Respond in 1-2 paragraphs.');
  });

  test('GH08.AC3.1: max_length="long" maps to 4-paragraph guidance', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', { text: 'test', max_length: 'long' });

    expect(captured.prompt).toContain('Respond in up to 4 paragraphs.');
  });

  test('GH08.AC3.1: missing max_length defaults to medium guidance', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', { text: 'test' });

    expect(captured.prompt).toContain('Respond in 1-2 paragraphs.');
  });

  test('GH08.AC4.1: instructions are appended as Focus guidance', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', {
      text: 'test',
      instructions: 'focus on technical claims',
    });

    expect(captured.prompt).toContain('Focus: focus on technical claims');
  });

  test('GH08.AC4.1: no instructions means no Focus line in prompt', async () => {
    const { captured, subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    await registry.execute('summarize', { text: 'test' });

    expect(captured.prompt).not.toContain('Focus:');
  });

  test('GH08.AC5.1: missing sub-agent throws a clear error', async () => {
    const registry = setupRegistry(undefined);

    await expect(registry.execute('summarize', { text: 'test' })).rejects.toThrow(
      /Sub-agent LLM not configured/,
    );
  });

  test('GH08.AC6.1: tool is registered with mode "both" so it appears in both native and sandbox surfaces', async () => {
    const { subAgent } = makeMockSubAgent();
    const registry = setupRegistry(subAgent);

    const nativeDefs = registry.generateToolDefinitions();
    const summarizeNative = nativeDefs.find((d) => d.name === 'summarize');
    expect(summarizeNative).toBeDefined();

    const sandboxStubs = registry.generateTypeScriptStubs();
    expect(sandboxStubs).toContain('summarize');
  });
});
