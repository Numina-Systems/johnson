// pattern: Functional Core + Imperative Shell

import type { Store } from '@/store/store.ts';

// ── Functional Core: Store summarization ──────────────────────────────────

export type StoreSummary = {
  readonly totalDocs: number;
  readonly prefixCounts: Record<string, number>;
  readonly topicClusters: ReadonlyArray<string>;
  readonly recentArchiveDates: ReadonlyArray<string>;
};

export function summarizeStore(store: Store): StoreSummary {
  const prefixCounts: Record<string, number> = {};
  const topicClusters: Array<string> = [];
  const archiveDates = new Set<string>();
  let totalDocs = 0;

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      totalDocs++;

      const prefix = doc.rkey.includes(':') ? doc.rkey.split(':')[0]! : doc.rkey;
      prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;

      if (doc.rkey.startsWith('index:')) {
        const firstLine = doc.content.split('\n').find(l => l.startsWith('# '));
        topicClusters.push(firstLine ?? doc.rkey);
      }

      if (doc.rkey.startsWith('archive:')) {
        const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(doc.rkey);
        if (dateMatch) archiveDates.add(dateMatch[1]!);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  const sortedDates = Array.from(archiveDates).sort().reverse().slice(0, 10);

  return { totalDocs, prefixCounts, topicClusters, recentArchiveDates: sortedDates };
}

export function formatStoreSummary(summary: StoreSummary): string {
  const lines: Array<string> = [];
  lines.push(`Total documents: ${summary.totalDocs}`);
  lines.push('');
  lines.push('Documents by prefix:');
  for (const [prefix, count] of Object.entries(summary.prefixCounts).sort()) {
    lines.push(`  ${prefix}: ${count}`);
  }
  if (summary.topicClusters.length > 0) {
    lines.push('');
    lines.push('Topic clusters:');
    for (const cluster of summary.topicClusters) {
      lines.push(`  - ${cluster}`);
    }
  }
  if (summary.recentArchiveDates.length > 0) {
    lines.push('');
    lines.push('Recent archive dates:');
    for (const date of summary.recentArchiveDates) {
      lines.push(`  - ${date}`);
    }
  }
  return lines.join('\n');
}
