// pattern: Imperative Shell

import type { SubAgentLLM } from '../model/sub-agent.ts';
import { parseDecompositionResponse, fallbackDecomposition, type DecompositionResult } from './decompose.ts';

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
