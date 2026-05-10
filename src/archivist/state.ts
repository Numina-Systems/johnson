// pattern: Functional Core

import type { ArchivistSnapshot, ChangeSet } from './types.ts';

const IMMUTABLE_PREFIXES = ['ref:', 'skill:', 'customtool:'] as const;

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

export function createEmptySnapshot(): ArchivistSnapshot {
  return {
    lastRun: new Date().toISOString(),
    mode: 'incremental',
    documents: {},
  };
}
