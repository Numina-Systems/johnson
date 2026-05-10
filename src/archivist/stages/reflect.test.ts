// pattern: Imperative Shell (test)

import { describe, test, expect } from 'bun:test';
import { createStore } from '@/store/store.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { BudgetTracker } from '../types.ts';
import {
  getArchivistSection,
  setArchivistSection,
  removeArchivistSection,
} from './reflect-sections.ts';
import { summarizeStore, formatStoreSummary, reflect } from './reflect.ts';

describe('reflect-sections: section management', () => {
  describe('setArchivistSection', () => {
    test('creates section when none exists (AC8.1)', () => {
      const content = 'Original content';
      const result = setArchivistSection(content, 'knowledge-domains', 'New section content');

      expect(result).toContain('<!-- archivist-managed: knowledge-domains -->');
      expect(result).toContain('New section content');
      expect(result).toContain('<!-- /archivist-managed: knowledge-domains -->');
      expect(result).toContain('Original content');
    });

    test('replaces existing section content (AC8.2)', () => {
      const content = `Original content

<!-- archivist-managed: knowledge-domains -->
Old section content
<!-- /archivist-managed: knowledge-domains -->

More content`;
      const result = setArchivistSection(
        content,
        'knowledge-domains',
        'New section content'
      );

      expect(result).toContain('New section content');
      expect(result).not.toContain('Old section content');
      expect(result).toContain('Original content');
      expect(result).toContain('More content');
    });

    test('preserves content outside markers (AC8.3)', () => {
      const content = `# My Document

Important header info

<!-- archivist-managed: knowledge-domains -->
Old section
<!-- /archivist-managed: knowledge-domains -->

Important footer info`;
      const result = setArchivistSection(
        content,
        'knowledge-domains',
        'New section'
      );

      expect(result).toContain('# My Document');
      expect(result).toContain('Important header info');
      expect(result).toContain('Important footer info');
      expect(result).not.toContain('Old section');
    });

    test('supports multiple independent labeled sections', () => {
      const content = 'Start';
      const withFirst = setArchivistSection(content, 'knowledge-domains', 'Domain content');
      const withBoth = setArchivistSection(
        withFirst,
        'user-patterns',
        'Pattern content'
      );

      expect(getArchivistSection(withBoth, 'knowledge-domains')).toBe(
        'Domain content'
      );
      expect(getArchivistSection(withBoth, 'user-patterns')).toBe(
        'Pattern content'
      );
    });
  });

  describe('getArchivistSection', () => {
    test('returns section content between markers', () => {
      const content = `Before

<!-- archivist-managed: test-label -->
Section content here
<!-- /archivist-managed: test-label -->

After`;
      const result = getArchivistSection(content, 'test-label');

      expect(result).toBe('Section content here');
    });

    test('returns null when section does not exist', () => {
      const content = 'Just some content without markers';
      const result = getArchivistSection(content, 'missing-section');

      expect(result).toBeNull();
    });

    test('handles multiline content within markers', () => {
      const content = `<!-- archivist-managed: multiline -->
Line 1
Line 2
Line 3
<!-- /archivist-managed: multiline -->`;
      const result = getArchivistSection(content, 'multiline');

      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
    });
  });

  describe('removeArchivistSection', () => {
    test('removes section and cleans up whitespace', () => {
      const content = `Content before

<!-- archivist-managed: to-remove -->
Section to remove
<!-- /archivist-managed: to-remove -->

Content after`;
      const result = removeArchivistSection(content, 'to-remove');

      expect(result).not.toContain('<!-- archivist-managed');
      expect(result).not.toContain('Section to remove');
      expect(result).toContain('Content before');
      expect(result).toContain('Content after');
    });

    test('handles missing section gracefully', () => {
      const content = 'Just some content';
      const result = removeArchivistSection(content, 'missing');

      expect(result).toBe('Just some content');
    });

    test('removes only the specified section', () => {
      const content = `<!-- archivist-managed: keep -->
Keep this
<!-- /archivist-managed: keep -->

<!-- archivist-managed: remove -->
Remove this
<!-- /archivist-managed: remove -->`;
      const result = removeArchivistSection(content, 'remove');

      expect(result).toContain('Keep this');
      expect(result).not.toContain('Remove this');
    });
  });
});

describe('reflect: store summarization', () => {
  describe('summarizeStore', () => {
    test('counts documents by prefix', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:topic1', 'content 1');
      store.docUpsert('knowledge:topic2', 'content 2');
      store.docUpsert('skill:helper', 'skill content');
      store.docUpsert('self', 'agent identity');

      const summary = summarizeStore(store);

      expect(summary.totalDocs).toBe(4);
      expect(summary.prefixCounts['knowledge']).toBe(2);
      expect(summary.prefixCounts['skill']).toBe(1);
      expect(summary.prefixCounts['self']).toBe(1);
    });

    test('extracts topic cluster names from index documents', () => {
      const store = createStore(':memory:');
      store.docUpsert('index:cluster-abc', '# Machine Learning\nContent here');
      store.docUpsert('knowledge:other', 'Some knowledge');

      const summary = summarizeStore(store);

      expect(summary.topicClusters.length).toBeGreaterThan(0);
      expect(summary.topicClusters).toContain('# Machine Learning');
    });

    test('extracts recent archive dates', () => {
      const store = createStore(':memory:');
      store.docUpsert('archive:2026-05-10T12:00:00Z', 'archive 1');
      store.docUpsert('archive:2026-05-09T12:00:00Z', 'archive 2');
      store.docUpsert('knowledge:other', 'other');

      const summary = summarizeStore(store);

      expect(summary.recentArchiveDates).toContain('2026-05-10');
      expect(summary.recentArchiveDates).toContain('2026-05-09');
    });

    test('limits recent archive dates to 10', () => {
      const store = createStore(':memory:');
      // Add 15 archive documents with different dates
      for (let i = 0; i < 15; i++) {
        const date = new Date('2026-05-01');
        date.setDate(date.getDate() + i);
        store.docUpsert(`archive:${date.toISOString()}`, `archive ${i}`);
      }

      const summary = summarizeStore(store);

      expect(summary.recentArchiveDates.length).toBeLessThanOrEqual(10);
    });
  });

  describe('formatStoreSummary', () => {
    test('formats summary with all sections', () => {
      const summary = {
        totalDocs: 42,
        prefixCounts: { knowledge: 15, skill: 5, self: 1 },
        topicClusters: ['# Topic A', '# Topic B'],
        recentArchiveDates: ['2026-05-10', '2026-05-09'],
      };

      const formatted = formatStoreSummary(summary);

      expect(formatted).toContain('Total documents: 42');
      expect(formatted).toContain('knowledge: 15');
      expect(formatted).toContain('skill: 5');
      expect(formatted).toContain('# Topic A');
      expect(formatted).toContain('2026-05-10');
    });

    test('handles empty topic clusters and archive dates', () => {
      const summary = {
        totalDocs: 5,
        prefixCounts: { knowledge: 5 },
        topicClusters: [],
        recentArchiveDates: [],
      };

      const formatted = formatStoreSummary(summary);

      expect(formatted).toContain('Total documents: 5');
      expect(formatted).not.toContain('Topic clusters:');
      expect(formatted).not.toContain('Recent archive dates:');
    });
  });
});

describe('reflect: integration tests', () => {
    function createMockSubAgent(): SubAgentLLM {
      return {
        async complete(prompt: string): Promise<string> {
          if (prompt.includes('knowledge domains')) {
            return '- Domain A: Core concepts\n- Domain B: Emergent patterns';
          }
          return '- User prefers detailed documentation\n- Focus on system design';
        },
      };
    }

    function createBudgetTracker(limit: number): BudgetTracker {
      return {
        limit,
        consumed: 0,
        breakdown: {},
        record(stage: string, tokens: number) {
          this.consumed += tokens;
          this.breakdown[stage] = (this.breakdown[stage] ?? 0) + tokens;
        },
        shouldContinue() {
          return this.consumed < this.limit;
        },
      };
    }

    test('reflect creates knowledge-domains section in self document (AC2.8)', async () => {
      const store = createStore(':memory:');
      store.docUpsert('self', '# Agent Identity\n\nSelf content');
      store.docUpsert('knowledge:topic1', 'Some knowledge');

      const result = await reflect({
        store,
        subAgent: createMockSubAgent(),
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      expect(result.skipped).toBe(false);
      const self = store.docGet('self');
      expect(self).not.toBeNull();
      expect(self!.content).toContain('<!-- archivist-managed: knowledge-domains -->');
      expect(self!.content).toContain('<!-- /archivist-managed: knowledge-domains -->');
      expect(self!.content).toContain('Domain A');
    });

    test('reflect updates existing knowledge-domains section (AC2.8)', async () => {
      const store = createStore(':memory:');
      const selfContent = `# Agent Identity

<!-- archivist-managed: knowledge-domains -->
Old knowledge
<!-- /archivist-managed: knowledge-domains -->

Other content`;
      store.docUpsert('self', selfContent);

      await reflect({
        store,
        subAgent: createMockSubAgent(),
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      const updated = store.docGet('self');
      expect(updated!.content).not.toContain('Old knowledge');
      expect(updated!.content).toContain('Domain A');
      expect(updated!.content).toContain('Other content');
    });

    test('reflect creates user-patterns section in operator document (AC2.9)', async () => {
      const store = createStore(':memory:');
      store.docUpsert('self', '# Agent');

      await reflect({
        store,
        subAgent: createMockSubAgent(),
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      const operator = store.docGet('operator');
      expect(operator).not.toBeNull();
      expect(operator!.content).toContain('<!-- archivist-managed: user-patterns -->');
      expect(operator!.content).toContain('<!-- /archivist-managed: user-patterns -->');
      expect(operator!.content).toContain('User prefers');
    });

    test('reflect creates operator document if missing (AC2.9)', async () => {
      const store = createStore(':memory:');
      store.docUpsert('self', '# Agent');

      await reflect({
        store,
        subAgent: createMockSubAgent(),
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      const operator = store.docGet('operator');
      expect(operator).not.toBeNull();
    });

    test('reflect preserves content outside markers (AC8.3)', async () => {
      const store = createStore(':memory:');
      const selfContent = `# Agent Identity

Important header

<!-- archivist-managed: knowledge-domains -->
Old
<!-- /archivist-managed: knowledge-domains -->

Important footer`;
      store.docUpsert('self', selfContent);

      await reflect({
        store,
        subAgent: createMockSubAgent(),
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      const updated = store.docGet('self');
      expect(updated!.content).toContain('Important header');
      expect(updated!.content).toContain('Important footer');
      expect(updated!.content).toContain('# Agent Identity');
    });

    test('skips reflect when no sub-agent available', async () => {
      const store = createStore(':memory:');
      store.docUpsert('self', '# Agent');

      const result = await reflect({
        store,
        subAgent: undefined,
        budget: createBudgetTracker(5000),
        systemPrompt: 'test system prompt',
      });

      expect(result.skipped).toBe(true);
    });
});
