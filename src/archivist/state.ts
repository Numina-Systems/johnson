// pattern: Functional Core + Imperative Shell

import type { ArchivistSnapshot, ChangeSet } from './types.ts';
import type { Store } from '@/store/store.ts';

const IMMUTABLE_PREFIXES = ['ref:', 'skill:', 'customtool:', 'context:'] as const;
export const STATE_RKEY = 'archivist:state';

export function isImmutable(rkey: string): boolean {
  return IMMUTABLE_PREFIXES.some(prefix => rkey.startsWith(prefix));
}

export function computeChangeSet(
  current: Record<string, string>,
  previous: Record<string, string> | undefined,
): ChangeSet {
  if (!previous) {
    const allKeys = Object.keys(current);
    return {
      added: allKeys,
      modified: [],
      deleted: [],
      unchanged: [],
    };
  }

  const added: Array<string> = [];
  const modified: Array<string> = [];
  const unchanged: Array<string> = [];

  for (const [rkey, hash] of Object.entries(current)) {
    if (!(rkey in previous)) {
      added.push(rkey);
    } else if (previous[rkey] !== hash) {
      modified.push(rkey);
    } else {
      unchanged.push(rkey);
    }
  }

  const deleted = Object.keys(previous).filter(rkey => !(rkey in current));

  return { added, modified, deleted, unchanged };
}

export function filterMutable(changeSet: ChangeSet): ChangeSet {
  return {
    added: changeSet.added.filter(rkey => !isImmutable(rkey)),
    modified: changeSet.modified.filter(rkey => !isImmutable(rkey)),
    deleted: changeSet.deleted.filter(rkey => !isImmutable(rkey)),
    unchanged: changeSet.unchanged,
  };
}

export function createEmptySnapshot(timestamp: string): ArchivistSnapshot {
  return {
    lastRun: timestamp,
    mode: 'incremental',
    documents: {},
  };
}

// ── Imperative Shell ────────────────────────────────────────────────────────

export function loadSnapshot(store: Store): ArchivistSnapshot | null {
  const doc = store.docGet(STATE_RKEY);
  if (!doc) return null;
  try {
    return JSON.parse(doc.content) as ArchivistSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(store: Store, snapshot: ArchivistSnapshot): void {
  store.docUpsert(STATE_RKEY, JSON.stringify(snapshot));
}
