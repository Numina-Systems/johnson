import { describe, test, expect } from 'bun:test';
import {
  parseDecompositionResponse,
  fallbackDecomposition,
  type DecompositionResult,
} from './decompose.ts';

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
