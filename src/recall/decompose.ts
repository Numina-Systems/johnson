// pattern: Functional Core

import type { SubAgentLLM } from '../model/sub-agent.ts';

export type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};

/**
 * Parses a JSON string into a DecompositionResult.
 * Validates structure and filters empty strings.
 * Returns empty decomposition on any validation failure.
 */
export function parseDecompositionResponse(raw: string): DecompositionResult {
  try {
    const parsed: unknown = JSON.parse(raw);

    // Validate parsed object has required properties
    if (typeof parsed !== 'object' || parsed === null) {
      return { queries: [], entities: [] };
    }

    const obj = parsed as Record<string, unknown>;

    // Validate queries is an array of strings
    if (!Array.isArray(obj.queries)) {
      return { queries: [], entities: [] };
    }

    if (!obj.queries.every((q): q is string => typeof q === 'string')) {
      return { queries: [], entities: [] };
    }

    // Validate entities is an array of strings
    if (!Array.isArray(obj.entities)) {
      return { queries: [], entities: [] };
    }

    if (!obj.entities.every((e): e is string => typeof e === 'string')) {
      return { queries: [], entities: [] };
    }

    // Filter out empty strings
    const queries = obj.queries.filter((q) => q.length > 0);
    const entities = obj.entities.filter((e) => e.length > 0);

    // Cap queries at 4 items
    const cappedQueries = queries.slice(0, 4);

    return {
      queries: cappedQueries,
      entities,
    };
  } catch {
    // JSON parse failed or any other error
    return { queries: [], entities: [] };
  }
}

/**
 * Returns a fallback decomposition using the raw message as a single query.
 */
export function fallbackDecomposition(message: string): DecompositionResult {
  return { queries: [message.trim()], entities: [] };
}

/**
 * Decomposes a user message into semantic queries and named entities.
 * Calls SubAgentLLM with a structured prompt.
 * Falls back to raw message on any error.
 */
export async function decomposeMessage(message: string, subAgent: SubAgentLLM): Promise<DecompositionResult> {
  try {
    const systemPrompt = `You are a decomposition assistant. Return only valid JSON, no markdown fencing, no explanation.`;

    const userPrompt = `Decompose this user message into search queries and named entities.

Message: "${message}"

Return JSON only:
{"queries": ["query1", "query2"], "entities": ["Entity1", "Entity2"]}

Rules:
- queries: 1-4 short phrases (2-6 words each) that capture the distinct topics in the message
- entities: proper nouns, project names, people, or specific terms for direct lookup
- If the message is simple, one query is fine
- If there are no proper nouns, entities should be an empty array`;

    const response = await subAgent.complete(userPrompt, systemPrompt);
    const parsed = parseDecompositionResponse(response);

    // If parsing returned empty queries (malformed JSON case), use fallback
    if (parsed.queries.length === 0) {
      return fallbackDecomposition(message);
    }

    return parsed;
  } catch {
    // SubAgentLLM failed - fallback to raw message
    return fallbackDecomposition(message);
  }
}
