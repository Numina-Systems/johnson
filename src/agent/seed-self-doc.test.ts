// pattern: Imperative Shell (test) — tests self-doc seeding with in-memory store

import { describe, test, expect } from 'bun:test';
import { seedSelfDoc } from './seed-self-doc.ts';
import { createStore } from '../store/store.ts';

describe('seedSelfDoc', () => {
  // ── prompt-templates.AC7.1: First run with empty self doc ──────────────

  describe('AC7.1: First run with empty self doc', () => {
    test('seeds self doc with marker and content when self doc is missing', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('<!-- seeded-from-persona -->');
    });

    test('seeded content includes identity paragraph with "Johnson"', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('Johnson');
      expect(result!.content).toContain('general-purpose AI agent');
    });

    test('seeded content includes obsidian vault section', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('Obsidian Vault');
      expect(result!.content).toContain('ref:obsidian-vault');
    });

    test('seeded content includes skill conventions section', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('Skills');
      expect(result!.content).toContain('skill:');
    });

    test('seeded content includes scheduled tasks section', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('Scheduled Tasks');
      expect(result!.content).toContain('tools.schedule_task');
    });

    test('seeded content includes file ingestion guidance', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('File Ingestion');
      expect(result!.content).toContain('ingest_file');
      expect(result!.content).toContain('pandoc');
    });
  });

  // ── prompt-templates.AC7.2: Existing content, no clobbering ────────────

  describe('AC7.2: Existing content without clobbering', () => {
    test('appends seeded content to existing self doc', () => {
      const store = createStore(':memory:');
      const existingContent = 'I learned that Giulia prefers markdown';

      store.docUpsert('self', existingContent);
      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain(existingContent);
    });

    test('preserves existing content at the beginning', () => {
      const store = createStore(':memory:');
      const existingContent = 'I learned that Giulia prefers markdown';

      store.docUpsert('self', existingContent);
      seedSelfDoc(store);

      const result = store.docGet('self');
      const contentIndex = result!.content.indexOf(existingContent);
      const markerIndex = result!.content.indexOf('<!-- seeded-from-persona -->');
      expect(contentIndex).toBeLessThan(markerIndex);
    });

    test('includes seed marker in appended content', () => {
      const store = createStore(':memory:');
      const existingContent = 'I learned that Giulia prefers markdown';

      store.docUpsert('self', existingContent);
      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toContain('<!-- seeded-from-persona -->');
    });

    test('appends seeded content after existing content', () => {
      const store = createStore(':memory:');
      const existingContent = 'I learned that Giulia prefers markdown';

      store.docUpsert('self', existingContent);
      seedSelfDoc(store);

      const result = store.docGet('self');
      const existingIndex = result!.content.indexOf(existingContent);
      const seededIndex = result!.content.indexOf('Johnson');
      expect(seededIndex).toBeGreaterThan(existingIndex);
    });
  });

  // ── prompt-templates.AC7.3: Already seeded, no duplication ──────────────

  describe('AC7.3: Already seeded document, no duplication', () => {
    test('does not duplicate content when called twice', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);
      const afterFirstSeed = store.docGet('self')!.content;

      seedSelfDoc(store);
      const afterSecondSeed = store.docGet('self')!.content;

      expect(afterFirstSeed).toEqual(afterSecondSeed);
    });

    test('skips seeding if marker already present', () => {
      const store = createStore(':memory:');
      const contentWithMarker = '<!-- seeded-from-persona -->\nIdentity section';

      store.docUpsert('self', contentWithMarker);
      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result!.content).toEqual(contentWithMarker);
    });

    test('content is identical after multiple calls', () => {
      const store = createStore(':memory:');

      seedSelfDoc(store);
      seedSelfDoc(store);
      seedSelfDoc(store);

      const result = store.docGet('self');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('<!-- seeded-from-persona -->');
    });
  });
});
