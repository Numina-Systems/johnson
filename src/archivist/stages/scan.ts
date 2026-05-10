// pattern: Imperative Shell

import { createHash } from 'node:crypto';
import type { Store } from '@/store/store.ts';
import type { ChangeSet, PipelineMode, StageResult } from '../types.ts';
import { computeChangeSet, filterMutable, loadSnapshot, STATE_RKEY } from '../state.ts';

export type ScanResult = {
  readonly changeSet: ChangeSet;
  readonly currentHashes: Record<string, string>;
  readonly stageResult: StageResult;
};

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function scan(store: Store, mode: PipelineMode): ScanResult {
  const currentHashes: Record<string, string> = {};

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      // Skip internal state document
      if (doc.rkey === STATE_RKEY) continue;
      currentHashes[doc.rkey] = hashContent(doc.content);
    }
    cursor = page.cursor;
  } while (cursor);

  const previous = loadSnapshot(store);
  const previousDocs = previous?.documents;

  const rawChangeSet = mode === 'full'
    ? computeChangeSet(currentHashes, undefined)
    : computeChangeSet(currentHashes, previousDocs);

  const changeSet = filterMutable(rawChangeSet);

  const totalDocs = Object.keys(currentHashes).length;
  const changedCount = changeSet.added.length + changeSet.modified.length + changeSet.deleted.length;

  return {
    changeSet,
    currentHashes,
    stageResult: {
      stage: 'scan',
      tokensUsed: 0,
      actions: [`scanned ${totalDocs} documents, ${changedCount} changes detected`],
      skipped: false,
    },
  };
}
