// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult, BudgetTracker } from '../types.ts';

const DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/;

export function extractDate(rkey: string): string | null {
  const match = DATE_PATTERN.exec(rkey);
  if (!match) return null;
  const candidate = match[1]!;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

export function isArchiveRkey(rkey: string): boolean {
  return rkey.startsWith('archive:') && !rkey.startsWith('archivist:');
}

export function isConsolidatedRkey(rkey: string): boolean {
  return rkey.startsWith('archive:consolidated:');
}

export function getCompressionDepth(content: string): number {
  const match = /<!-- archivist-consolidated: depth=(\d+)/.exec(content);
  return match ? parseInt(match[1]!, 10) : 0;
}

export type ArchiveGroup = {
  readonly date: string;
  readonly documents: ReadonlyArray<{ rkey: string; content: string }>;
};

export function groupArchivesByDate(
  documents: ReadonlyArray<{ rkey: string; content: string }>,
): ReadonlyArray<ArchiveGroup> {
  const groups = new Map<string, Array<{ rkey: string; content: string }>>();

  for (const doc of documents) {
    if (!isArchiveRkey(doc.rkey)) continue;
    const date = extractDate(doc.rkey);
    if (!date) continue;

    const existing = groups.get(date);
    if (existing) {
      existing.push(doc);
    } else {
      groups.set(date, [doc]);
    }
  }

  return Array.from(groups.entries())
    .map(([date, docs]) => ({ date, documents: docs }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildConsolidatedRkey(date: string, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `archive:consolidated:${date}:${ts}`;
}

export function buildConsolidationMarker(
  depth: number,
  sourceCount: number,
  date: string,
): string {
  return `<!-- archivist-consolidated: depth=${depth}, sources=${sourceCount}, date=${date} -->`;
}

type ConsolidateDeps = {
  readonly store: Store;
  readonly subAgent: SubAgentLLM;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

function getConsolidationPrompt(depth: number): string {
  if (depth === 1) {
    return 'Synthesize these conversation archives into a coherent summary. Preserve key details, decisions, and action items.';
  }
  if (depth === 2) {
    return 'Compress this consolidated archive further. Keep only the highest-level insights, decisions, and outcomes.';
  }
  return 'Aggressively compress this archive to essential facts only.';
}

export async function consolidate(
  deps: ConsolidateDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  const actions: Array<string> = [];

  // Guard: require sub-agent
  if (!deps.subAgent) {
    return {
      stage: 'consolidate',
      tokensUsed: 0,
      actions,
      skipped: true,
    };
  }

  // Load all archive documents via cursor-paginated docList()
  const allDocs: Array<{ rkey: string; content: string }> = [];
  let cursor: string | undefined;
  do {
    const page = deps.store.docList(500, cursor);
    for (const doc of page.documents) {
      allDocs.push(doc);
    }
    cursor = page.cursor;
  } while (cursor);

  // Group archives by date
  const groups = groupArchivesByDate(allDocs);

  let tokensUsed = 0;

  // Build set of changed documents
  const changedSet = new Set([...changeSet.added, ...changeSet.modified]);

  // Process each group
  for (const group of groups) {
    // In incremental mode, only process groups with at least one changed document
    if (mode === 'incremental') {
      const hasChanged = group.documents.some(doc => changedSet.has(doc.rkey));
      if (!hasChanged) continue;
    }

    // Consolidate if 2+ documents
    if (group.documents.length >= 2) {
      // Concatenate all document contents
      const concatenated = group.documents.map(doc => doc.content).join('\n\n---\n\n');

      // Determine compression depth
      const maxSourceDepth = Math.max(
        ...group.documents.map(doc => getCompressionDepth(doc.content)),
      );
      const newDepth = maxSourceDepth + 1;

      // Get instruction for this depth
      const instruction = getConsolidationPrompt(newDepth);

      // Send to sub-agent with system prompt and instruction in user prompt
      const userPrompt = `${instruction}\n\n${concatenated}`;
      const synthesized = await deps.subAgent.complete(userPrompt, deps.systemPrompt);
      tokensUsed += synthesized.length; // rough estimate

      // Build consolidated rkey
      const consolidatedRkey = buildConsolidatedRkey(group.date);

      // Build consolidation marker
      const marker = buildConsolidationMarker(
        newDepth,
        group.documents.length,
        group.date,
      );

      // Write consolidated document with marker prepended
      const consolidatedContent = `${marker}\n\n${synthesized}`;
      deps.store.docUpsert(consolidatedRkey, consolidatedContent);

      // Delete original source documents
      for (const doc of group.documents) {
        deps.store.docDelete(doc.rkey);
      }

      actions.push(
        `consolidated ${group.documents.length} archives for ${group.date} at depth ${newDepth}`,
      );
    } else if (mode === 'full') {
      // For already-consolidated single documents (depth > 0), apply further compression on full sweeps only
      for (const doc of group.documents) {
        const depth = getCompressionDepth(doc.content);
        if (depth > 0 && !isConsolidatedRkey(doc.rkey)) {
          // This is an already-consolidated doc but not in consolidated format,
          // could happen with old consolidated docs. Re-consolidate if needed.
          continue;
        }

        // For consolidated docs in full mode, compress further
        if (isConsolidatedRkey(doc.rkey) && depth > 0) {
          const instruction = getConsolidationPrompt(depth + 1);
          const userPrompt = `${instruction}\n\n${doc.content}`;
          const synthesized = await deps.subAgent.complete(userPrompt, deps.systemPrompt);
          tokensUsed += synthesized.length;

          const newDepth = depth + 1;
          const marker = buildConsolidationMarker(newDepth, 1, group.date);
          const recompressedContent = `${marker}\n\n${synthesized}`;

          deps.store.docUpsert(doc.rkey, recompressedContent);
          actions.push(`re-compressed consolidated archive ${doc.rkey} to depth ${newDepth}`);
        }
      }
    }

    if (!deps.budget.shouldContinue()) {
      break;
    }
  }

  deps.budget.record('consolidate', tokensUsed);

  return {
    stage: 'consolidate',
    tokensUsed,
    actions,
    skipped: false,
  };
}
