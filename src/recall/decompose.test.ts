// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import {
  parseDecompositionResponse,
  fallbackDecomposition,
  decomposeMessage,
  type DecompositionResult,
} from './decompose.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';

describe('parseDecompositionResponse', () => {
  test('reflexive-recall.AC1.1: parses valid JSON with queries and entities', () => {
    const json = JSON.stringify({
      queries: ['CalDAV project'],
      entities: ['CalDAV'],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual(['CalDAV project']);
    expect(result.entities).toEqual(['CalDAV']);
  });

  test('reflexive-recall.AC1.2: parses multiple queries', () => {
    const json = JSON.stringify({
      queries: ['first topic', 'second topic', 'third topic'],
      entities: ['Entity1', 'Entity2'],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual(['first topic', 'second topic', 'third topic']);
    expect(result.entities).toEqual(['Entity1', 'Entity2']);
  });

  test('reflexive-recall.AC1.3: parses single-word query', () => {
    const json = JSON.stringify({
      queries: ['word'],
      entities: [],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual(['word']);
  });

  test('reflexive-recall.AC1.4: parses empty entities array', () => {
    const json = JSON.stringify({
      queries: ['some query'],
      entities: [],
    });

    const result = parseDecompositionResponse(json);

    expect(result.entities).toEqual([]);
  });

  test('reflexive-recall.AC5.2: returns empty decomposition for malformed JSON', () => {
    const result = parseDecompositionResponse('not valid json');

    expect(result.queries).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  test('filters out empty strings from queries', () => {
    const json = JSON.stringify({
      queries: ['query1', '', 'query2', ''],
      entities: ['entity'],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual(['query1', 'query2']);
  });

  test('filters out empty strings from entities', () => {
    const json = JSON.stringify({
      queries: ['query'],
      entities: ['entity1', '', 'entity2'],
    });

    const result = parseDecompositionResponse(json);

    expect(result.entities).toEqual(['entity1', 'entity2']);
  });

  test('caps queries at 4 items', () => {
    const json = JSON.stringify({
      queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
      entities: [],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toHaveLength(4);
    expect(result.queries).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  test('returns empty decomposition when queries is not an array', () => {
    const json = JSON.stringify({
      queries: 'not an array',
      entities: [],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  test('returns empty decomposition when entities is not an array', () => {
    const json = JSON.stringify({
      queries: ['query'],
      entities: 'not an array',
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  test('ignores extra fields in JSON', () => {
    const json = JSON.stringify({
      queries: ['query'],
      entities: ['entity'],
      extra: 'field',
      another: 123,
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual(['query']);
    expect(result.entities).toEqual(['entity']);
  });

  test('returns empty decomposition when queries array contains non-strings', () => {
    const json = JSON.stringify({
      queries: ['valid', 123, 'query'],
      entities: [],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  test('returns empty decomposition when entities array contains non-strings', () => {
    const json = JSON.stringify({
      queries: ['query'],
      entities: ['valid', null, 'entity'],
    });

    const result = parseDecompositionResponse(json);

    expect(result.queries).toEqual([]);
    expect(result.entities).toEqual([]);
  });
});

describe('fallbackDecomposition', () => {
  test('returns single query containing the trimmed message', () => {
    const result = fallbackDecomposition('  test message  ');

    expect(result.queries).toEqual(['test message']);
  });

  test('returns empty entities array', () => {
    const result = fallbackDecomposition('any message');

    expect(result.entities).toEqual([]);
  });

  test('works with empty string', () => {
    const result = fallbackDecomposition('');

    expect(result.queries).toEqual(['']);
    expect(result.entities).toEqual([]);
  });
});

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
