// pattern: Imperative Shell

import type { Store } from '@/store/store.ts';

const MIGRATION_MARKER = '<!-- archivist-ref-migration-complete -->';
const MIGRATION_RKEY = 'archivist:ref-migration';

const REF_EXTENSIONS = ['.pdf', '.epub', '.mobi', '.djvu'];
const MIN_CHUNKS_FOR_REF = 10;

// Intentionally mixes logic and I/O — one-time migration code, not worth separating
function isReferenceBook(rkey: string, content: string, store: Store): boolean {
  const sourceMatch = /<!-- source: (.+?) -->/.exec(content);
  if (sourceMatch) {
    const sourcePath = sourceMatch[1]!.toLowerCase();
    if (REF_EXTENSIONS.some(ext => sourcePath.endsWith(ext))) return true;
  }

  // Chunk numbering is always contiguous (0-indexed, no gaps) per chunking.ts
  let chunkCount = 0;
  let i = 0;
  while (store.docGet(`${rkey}:chunk:${i}`)) {
    chunkCount++;
    i++;
    if (chunkCount >= MIN_CHUNKS_FOR_REF) return true;
  }

  return false;
}

export function migrateRefsFromKnowledge(store: Store): { migrated: number; skipped: boolean } {
  const migrationDoc = store.docGet(MIGRATION_RKEY);
  if (migrationDoc?.content?.includes(MIGRATION_MARKER)) {
    return { migrated: 0, skipped: true };
  }

  let migrated = 0;
  const toMigrate: Array<{ oldRkey: string; newRkey: string; content: string }> = [];

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      if (!doc.rkey.startsWith('knowledge:')) continue;
      if (doc.rkey.includes(':chunk:')) continue;

      if (isReferenceBook(doc.rkey, doc.content, store)) {
        const newRkey = doc.rkey.replace(/^knowledge:/, 'ref:');
        toMigrate.push({ oldRkey: doc.rkey, newRkey, content: doc.content });
      }
    }
    cursor = page.cursor;
  } while (cursor);

  for (const { oldRkey, newRkey, content } of toMigrate) {
    store.docUpsert(newRkey, content);

    let i = 0;
    while (true) {
      const chunkDoc = store.docGet(`${oldRkey}:chunk:${i}`);
      if (!chunkDoc) break;
      store.docUpsert(`${newRkey}:chunk:${i}`, chunkDoc.content);
      store.docDelete(`${oldRkey}:chunk:${i}`);
      i++;
    }

    store.docDelete(oldRkey);
    migrated++;
  }

  store.docUpsert(MIGRATION_RKEY, MIGRATION_MARKER);

  return { migrated, skipped: false };
}

const COMPACTION_MIGRATION_MARKER = '<!-- archivist-compaction-migration-complete -->';
const COMPACTION_MIGRATION_RKEY = 'archivist:compaction-migration';

export function migrateCompactionArchives(store: Store): { deleted: number; skipped: boolean } {
  const migrationDoc = store.docGet(COMPACTION_MIGRATION_RKEY);
  if (migrationDoc?.content?.includes(COMPACTION_MIGRATION_MARKER)) {
    return { deleted: 0, skipped: true };
  }

  let deleted = 0;
  const toDelete: Array<string> = [];

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      if (!doc.rkey.startsWith('archive:')) continue;
      if (doc.rkey.startsWith('archive:session:')) continue;
      if (doc.rkey.startsWith('archive:consolidated:')) continue;
      toDelete.push(doc.rkey);
    }
    cursor = page.cursor;
  } while (cursor);

  for (const rkey of toDelete) {
    store.docDelete(rkey);
    deleted++;
  }

  store.docUpsert(COMPACTION_MIGRATION_RKEY, COMPACTION_MIGRATION_MARKER);

  return { deleted, skipped: false };
}
