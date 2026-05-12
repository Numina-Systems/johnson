import { describe, expect, test } from 'bun:test';
import { formatMessage, formatMessageHistory, mapStoreRole } from './format.ts';
import { highlightMarkdown } from '../syntax.ts';
import { palette, blessedStyles } from '../theme.ts';

describe('format module', () => {
  describe('mapStoreRole', () => {
    test('converts assistant to agent', () => {
      expect(mapStoreRole('assistant')).toBe('agent');
    });

    test('keeps user unchanged', () => {
      expect(mapStoreRole('user')).toBe('user');
    });

    test('converts unknown roles to system', () => {
      expect(mapStoreRole('unknown')).toBe('system');
      expect(mapStoreRole('foo')).toBe('system');
      expect(mapStoreRole('')).toBe('system');
    });
  });

  describe('formatMessage', () => {
    test('formats user messages with lavender colour tag', () => {
      const msg = { role: 'user' as const, text: 'hello world' };
      const result = formatMessage(msg);

      expect(result).toContain('{bold}');
      expect(result).toContain(blessedStyles.userMsg.fg);
      expect(result).toContain('you>');
      expect(result).toContain('hello world');
    });

    test('formats agent messages with green colour tag and highlighting', () => {
      const msg = { role: 'agent' as const, text: 'response text' };
      const result = formatMessage(msg);

      expect(result).toContain('{bold}');
      expect(result).toContain(blessedStyles.agentMsg.fg);
      expect(result).toContain('agent>');
      // Verify that the message text was passed through highlightMarkdown
      // by checking that the response contains the highlighted result
      const highlighted = highlightMarkdown('response text');
      expect(result).toContain(highlighted);
    });

    test('formats system messages with yellow colour tag', () => {
      const msg = { role: 'system' as const, text: 'system notice' };
      const result = formatMessage(msg);

      expect(result).toContain('[system]');
      expect(result).toContain(blessedStyles.systemMsg.fg);
      expect(result).toContain('system notice');
    });

    test('handles code blocks in agent messages', () => {
      const msg = {
        role: 'agent' as const,
        text: 'here is code:\n```typescript\nconst x = 1;\n```\ndone'
      };
      const result = formatMessage(msg);

      expect(result).toContain('agent>');
      // Should contain the highlighted version of the code block (may have ANSI codes)
      expect(result).toContain('const');
      expect(result).toContain('done');
    });

    test('user and system messages do not call highlightMarkdown', () => {
      const userMsg = { role: 'user' as const, text: 'plain text' };
      const systemMsg = { role: 'system' as const, text: 'plain text' };

      // These should not have the syntax highlighting separators
      const userResult = formatMessage(userMsg);
      const systemResult = formatMessage(systemMsg);

      expect(userResult).not.toContain('─');
      expect(systemResult).not.toContain('─');
    });
  });

  describe('formatMessageHistory', () => {
    test('joins single message unchanged', () => {
      const messages = [
        { role: 'user' as const, text: 'hello' }
      ];
      const result = formatMessageHistory(messages);

      expect(result).toContain('hello');
    });

    test('separates messages with double newlines', () => {
      const messages = [
        { role: 'user' as const, text: 'message 1' },
        { role: 'agent' as const, text: 'message 2' }
      ];
      const result = formatMessageHistory(messages);

      // Should have the formatted messages separated by \n\n
      const parts = result.split('\n\n');
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    test('formats all messages in history', () => {
      const messages = [
        { role: 'user' as const, text: 'hi' },
        { role: 'agent' as const, text: 'hello' },
        { role: 'system' as const, text: 'notice' }
      ];
      const result = formatMessageHistory(messages);

      expect(result).toContain('you>');
      expect(result).toContain('agent>');
      expect(result).toContain('[system]');
    });

    test('handles empty message list', () => {
      const result = formatMessageHistory([]);
      expect(typeof result).toBe('string');
    });
  });
});
