// pattern: Functional Core

import type { DecompositionResult } from './decompose.ts';
import { hybridSearch, type HybridSearchDeps, type HybridSearchResult } from '../search/hybrid.ts';
import type { Store } from '../store/store.ts';
import { estimateTokens } from '../agent/context.ts';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type RecallFragment = {
  readonly rkey: string;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
};

export type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Prefix filtering
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  'knowledge:',
  'skill:',
  'archive:',
];

/**
 * Filters fragments to only those whose rkey starts with allowed prefixes.
 * Default allowed prefixes exclude self, operator, task:*, and customtool:*.
 */
export function filterByPrefix(
  fragments: ReadonlyArray<RecallFragment>,
  allowedPrefixes: ReadonlyArray<string> = DEFAULT_ALLOWED_PREFIXES,
): Array<RecallFragment> {
  return fragments.filter((f) =>
    allowedPrefixes.some((p) => f.rkey.startsWith(p))
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────

/**
 * Deduplicates fragments by rkey, keeping the entry with the highest score.
 */
export function deduplicateFragments(
  fragments: ReadonlyArray<RecallFragment>,
): Array<RecallFragment> {
  const seen = new Map<string, RecallFragment>();

  for (const f of fragments) {
    const existing = seen.get(f.rkey);
    if (!existing || f.score > existing.score) {
      seen.set(f.rkey, f);
    }
  }

  return Array.from(seen.values());
}

// ─────────────────────────────────────────────────────────────────────────
// Token budgeting
// ─────────────────────────────────────────────────────────────────────────

/**
 * Trims fragments to fit within a token budget.
 * Fragments are included in order of score (descending).
 * If a fragment exceeds remaining budget but budget > 0, it is truncated to fit.
 * Returns the trimmed fragments and total tokens consumed.
 */
export function trimToTokenBudget(
  fragments: ReadonlyArray<RecallFragment>,
  budget: number,
): { fragments: Array<RecallFragment>; totalTokens: number } {
  const result: Array<RecallFragment> = [];
  let totalTokens = 0;

  for (const f of fragments) {
    const tokens = estimateTokens(f.content);

    if (totalTokens + tokens <= budget) {
      result.push(f);
      totalTokens += tokens;
    } else {
      const remaining = budget - totalTokens;
      if (remaining > 0) {
        const truncatedContent = f.content.slice(0, remaining * 4);
        result.push({ ...f, content: truncatedContent });
        totalTokens += estimateTokens(truncatedContent);
      }
      break;
    }
  }

  return { fragments: result, totalTokens };
}

// ─────────────────────────────────────────────────────────────────────────
// Main retrieval entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Retrieves context from the knowledge store for a decomposed query.
 *
 * Steps:
 * 1. Run each semantic query through hybridSearch (up to 5 results per query)
 * 2. Run each entity through FTS lookup (up to 3 results per entity)
 * 3. Combine and deduplicate by rkey (keeping highest score)
 * 4. Filter by allowed prefixes
 * 5. Sort by score descending
 * 6. Trim to token budget
 *
 * Returns a RecallResult with fragments, total tokens, query count, and elapsed time.
 */
export async function retrieveContext(
  decomposition: DecompositionResult,
  deps: HybridSearchDeps,
  tokenBudget: number = 1500,
  allowedPrefixes: ReadonlyArray<string> = DEFAULT_ALLOWED_PREFIXES,
): Promise<RecallResult> {
  const startTime = Date.now();
  const allFragments: Array<RecallFragment> = [];

  // Step 1: Run semantic queries through hybridSearch
  for (const query of decomposition.queries) {
    try {
      const results = await hybridSearch(deps, query, 5);
      for (const result of results) {
        allFragments.push({
          rkey: result.rkey,
          content: result.content,
          score: result.score,
          source: 'semantic',
        });
      }
    } catch {
      // Query failed — continue with other queries
    }
  }

  // Step 2: Run entities through FTS lookup
  for (const entity of decomposition.entities) {
    const results = deps.store.docSearch(entity, 3);
    for (const result of results) {
      // Convert FTS rank to comparable score: 1 / (60 + rank)
      const score = 1 / (60 + result.rank);
      allFragments.push({
        rkey: result.rkey,
        content: result.content,
        score,
        source: 'entity',
      });
    }
  }

  // Step 3: Deduplicate by rkey (keeping highest score)
  const deduplicated = deduplicateFragments(allFragments);

  // Step 4: Filter by allowed prefixes
  const filtered = filterByPrefix(deduplicated, allowedPrefixes);

  // Step 5: Sort by score descending
  const sorted = [...filtered].sort((a, b) => b.score - a.score);

  // Step 6: Trim to token budget
  const { fragments, totalTokens } = trimToTokenBudget(sorted, tokenBudget);

  const elapsed = Date.now() - startTime;
  const queryCount = decomposition.queries.length + decomposition.entities.length;

  return {
    fragments,
    totalTokens,
    queryCount,
    elapsed,
  };
}
