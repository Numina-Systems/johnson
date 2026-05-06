// pattern: Functional Core

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
