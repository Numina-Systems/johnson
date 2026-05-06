import { describe, test, expect } from 'bun:test';
import { decomposeMessage } from './decompose-message.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';

// Helper for mocking SubAgentLLM
type SubAgentCall = { prompt: string; system?: string };

function makeMockSubAgent(response: string): { subAgent: SubAgentLLM; calls: SubAgentCall[] } {
  const calls: SubAgentCall[] = [];
  const subAgent: SubAgentLLM = {
    async complete(prompt: string, system?: string) {
      calls.push({ prompt, system });
      return response;
    },
  };
  return { subAgent, calls };
}

describe('decomposeMessage', () => {
  test('reflexive-recall.AC1.1: decomposes message with SubAgentLLM', async () => {
    const validJson = JSON.stringify({
      queries: ['CalDAV project'],
      entities: ['CalDAV'],
    });
    const { subAgent, calls } = makeMockSubAgent(validJson);

    const result = await decomposeMessage('Tell me about the CalDAV project', subAgent);

    expect(result.queries).toEqual(['CalDAV project']);
    expect(result.entities).toEqual(['CalDAV']);

    // Verify SubAgentLLM was called with appropriate prompt
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('Tell me about the CalDAV project');
  });

  test('reflexive-recall.AC5.1: falls back to raw message when SubAgentLLM throws', async () => {
    const subAgent: SubAgentLLM = {
      async complete() {
        throw new Error('Network error');
      },
    };

    const result = await decomposeMessage('test message', subAgent);

    expect(result.queries).toEqual(['test message']);
    expect(result.entities).toEqual([]);
  });

  test('reflexive-recall.AC5.2: falls back to raw message for malformed JSON', async () => {
    const { subAgent } = makeMockSubAgent('not valid json at all');

    const result = await decomposeMessage('test message', subAgent);

    expect(result.queries).toEqual(['test message']);
    expect(result.entities).toEqual([]);
  });

  test('decomposes multi-topic message', async () => {
    const validJson = JSON.stringify({
      queries: ['database migration', 'schema changes', 'performance impact'],
      entities: ['PostgreSQL', 'TypeScript'],
    });
    const { subAgent } = makeMockSubAgent(validJson);

    const result = await decomposeMessage('How do database migration and schema changes affect performance?', subAgent);

    expect(result.queries).toHaveLength(3);
    expect(result.entities).toHaveLength(2);
  });

  test('includes system prompt in SubAgentLLM call', async () => {
    const { subAgent, calls } = makeMockSubAgent(JSON.stringify({ queries: [], entities: [] }));

    await decomposeMessage('test', subAgent);

    expect(calls[0].system).toBeDefined();
    expect(calls[0].system).toContain('JSON');
  });
});
