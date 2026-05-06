import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt } from './context.ts';

describe('buildSystemPrompt', () => {
  const testPersona = 'You are a helpful agent.';
  const testSelfDoc = '\n\n## Your Memory (auto-loaded)\nAgent state and preferences';
  const testSkillNames = ['skill:test-skill'];
  const testToolDocs = '\n\n## Tool Reference\n\nTools available...';
  const testTimezone = 'UTC';

  describe('reflexive-recall.AC7.1 — Section positioning', () => {
    test('reflexive-recall.AC7.1: Recalled Context appears after self doc and before Available Skills', () => {
      const recalledContext = [
        { rkey: 'knowledge:test', content: 'Test content' },
      ];

      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        recalledContext,
      );

      // Verify order: Your Memory < Recalled Context < Available Skills
      const memoryIndex = prompt.indexOf('Your Memory');
      const recalledIndex = prompt.indexOf('Recalled Context');
      const skillsIndex = prompt.indexOf('Available Skills');

      expect(memoryIndex).toBeGreaterThan(-1);
      expect(recalledIndex).toBeGreaterThan(-1);
      expect(skillsIndex).toBeGreaterThan(-1);

      expect(recalledIndex).toBeGreaterThan(memoryIndex);
      expect(skillsIndex).toBeGreaterThan(recalledIndex);
    });
  });

  describe('reflexive-recall.AC7.2 — Fragment rendering', () => {
    test('reflexive-recall.AC7.2: Renders each fragment with rkey header and content', () => {
      const recalledContext = [
        { rkey: 'knowledge:caldav', content: 'CalDAV protocol notes' },
        { rkey: 'skill:fetch-page', content: 'Fetches web pages' },
      ];

      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        recalledContext,
      );

      // Verify first fragment
      expect(prompt).toContain('### knowledge:caldav');
      expect(prompt).toContain('CalDAV protocol notes');

      // Verify second fragment
      expect(prompt).toContain('### skill:fetch-page');
      expect(prompt).toContain('Fetches web pages');
    });

    test('Does not include score metadata', () => {
      const recalledContext = [
        { rkey: 'knowledge:test', content: 'Content here' },
      ];

      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        recalledContext,
      );

      // Verify no numeric scores or "score" keywords appear
      expect(prompt).not.toContain('score');
      expect(prompt).not.toContain('0.');
    });
  });

  describe('reflexive-recall.AC7.3 — Absent recalledContext', () => {
    test('reflexive-recall.AC7.3: Produces no Recalled Context section when recalledContext is undefined', () => {
      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        undefined,
      );

      expect(prompt).not.toContain('## Recalled Context');
    });

    test('Produces no Recalled Context section when recalledContext is empty array', () => {
      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        [],
      );

      expect(prompt).not.toContain('## Recalled Context');
    });

    test('Default parameter behavior (no recalledContext argument)', () => {
      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
      );

      expect(prompt).not.toContain('## Recalled Context');
    });
  });

  describe('reflexive-recall.AC4.3 — Zero documents', () => {
    test('reflexive-recall.AC4.3: Zero matching documents produces no system prompt section', () => {
      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        [], // Empty array = zero documents
      );

      expect(prompt).not.toContain('## Recalled Context');
    });
  });

  describe('Additional — Existing sections unaffected', () => {
    test('All existing sections remain present with recalledContext', () => {
      const recalledContext = [
        { rkey: 'knowledge:test', content: 'Test content' },
      ];

      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        recalledContext,
      );

      // Verify all standard sections are present
      expect(prompt).toContain(testPersona);
      expect(prompt).toContain('## Current Time');
      expect(prompt).toContain('## Your Memory');
      expect(prompt).toContain('## Available Skills');
      expect(prompt).toContain('## Tool Reference');
      expect(prompt).toContain('## Recalled Context');
    });

    test('Sections maintain proper formatting and newlines', () => {
      const recalledContext = [
        { rkey: 'knowledge:test', content: 'Test content' },
      ];

      const prompt = buildSystemPrompt(
        testPersona,
        testSelfDoc,
        testSkillNames,
        testToolDocs,
        testTimezone,
        recalledContext,
      );

      // Check that Recalled Context has proper structure
      expect(prompt).toMatch(/## Recalled Context/);
      expect(prompt).toMatch(/### knowledge:test/);
    });
  });
});
