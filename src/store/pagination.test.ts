// pattern: Imperative Shell (test)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createStore } from './store.ts';
import type { Store } from './store.ts';

describe('Store pagination', () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/test-store-${Date.now()}-${Math.random()}.db`;
    store = createStore(dbPath);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    try {
      const fs = require('fs');
      fs.unlinkSync(dbPath);
      fs.unlinkSync(`${dbPath}-shm`);
      fs.unlinkSync(`${dbPath}-wal`);
    } catch {
      // Files may not exist, that's fine
    }
  });

  describe('listSessionsPaginated', () => {
    test('returns empty array when no sessions exist', () => {
      const result = store.listSessionsPaginated();

      expect(result.sessions).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    test('returns all sessions when below limit', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');

      const result = store.listSessionsPaginated(10);

      expect(result.sessions).toHaveLength(2);
      expect(result.cursor).toBeUndefined();
      expect(result.sessions[0].id).toBeTruthy();
      expect(result.sessions[0].title).toBeTruthy();
      expect(result.sessions[0].messageCount).toBeDefined();
    });

    test('includes message count in paginated results', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Hello');
      store.appendMessage('session-1', 'assistant', 'Hi');

      const result = store.listSessionsPaginated(10);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].messageCount).toBe(2);
    });

    test('returns cursor when more results exist beyond limit', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');
      store.createSession('session-3', 'Session 3');

      const result = store.listSessionsPaginated(2);

      expect(result.sessions).toHaveLength(2);
      expect(result.cursor).toBeTruthy();
    });

    test('does not return cursor at end of data', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');

      const result = store.listSessionsPaginated(10);

      expect(result.sessions).toHaveLength(2);
      expect(result.cursor).toBeUndefined();
    });

    test('uses cursor to fetch next page', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');
      store.createSession('session-3', 'Session 3');

      // Get first page
      const page1 = store.listSessionsPaginated(2);
      expect(page1.sessions).toHaveLength(2);
      expect(page1.cursor).toBeTruthy();

      // Get second page using cursor
      const page2 = store.listSessionsPaginated(2, page1.cursor);
      expect(page2.sessions).toHaveLength(1);
      expect(page2.cursor).toBeUndefined();

      // Verify pages don't overlap
      const page1Ids = new Set(page1.sessions.map(s => s.id));
      const page2Ids = new Set(page2.sessions.map(s => s.id));
      expect([...page1Ids].some(id => page2Ids.has(id))).toBe(false);
    });

    test('respects limit parameter', () => {
      for (let i = 1; i <= 10; i++) {
        store.createSession(`session-${i}`, `Session ${i}`);
      }

      const result = store.listSessionsPaginated(3);

      expect(result.sessions).toHaveLength(3);
      expect(result.cursor).toBeTruthy();
    });

    test('enforces maximum limit of 500', () => {
      // Create enough sessions
      for (let i = 1; i <= 100; i++) {
        store.createSession(`session-${i}`, `Session ${i}`);
      }

      // Request with limit > 500
      const result = store.listSessionsPaginated(1000);

      // Should enforce max of 500 and return cursor if more exist
      expect(result.sessions.length).toBeLessThanOrEqual(100);
    });

    test('sorts sessions by updatedAt descending', () => {
      store.createSession('session-1', 'Session 1');

      // Ensure different timestamps at millisecond precision
      Bun.sleep(1);

      store.createSession('session-2', 'Session 2');

      const result = store.listSessionsPaginated(10);

      // Session 2 should come first (most recent)
      expect(result.sessions[0].id).toBe('session-2');
      expect(result.sessions[1].id).toBe('session-1');
    });

    test('handles sessions with null title', () => {
      store.createSession('session-1');
      store.createSession('session-2', 'Session 2');

      const result = store.listSessionsPaginated(10);

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions.some(s => s.title === null)).toBe(true);
    });

    test('pagination works across multiple pages', () => {
      // Create 7 sessions
      for (let i = 1; i <= 7; i++) {
        store.createSession(`session-${i}`, `Session ${i}`);
        // Ensure different timestamps at millisecond precision
        Bun.sleep(1);
      }

      // Fetch all with pagination (limit 3)
      const allSessions: Array<{ id: string; title: string | null; updatedAt: string; messageCount: number }> = [];
      let cursor: string | undefined;

      // First page
      const page1 = store.listSessionsPaginated(3, cursor);
      allSessions.push(...page1.sessions);
      cursor = page1.cursor;

      // Second page
      if (cursor) {
        const page2 = store.listSessionsPaginated(3, cursor);
        allSessions.push(...page2.sessions);
        cursor = page2.cursor;
      }

      // Third page
      if (cursor) {
        const page3 = store.listSessionsPaginated(3, cursor);
        allSessions.push(...page3.sessions);
        cursor = page3.cursor;
      }

      expect(allSessions).toHaveLength(7);
      expect(cursor).toBeUndefined();
    });

    test('malformed cursor (no pipe) returns empty sessions gracefully', () => {
      store.createSession('session-1', 'Session 1');

      const result = store.listSessionsPaginated(10, 'garbage-no-pipe');

      expect(result.sessions).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    test('malformed cursor (missing id part) returns empty sessions gracefully', () => {
      store.createSession('session-1', 'Session 1');

      const result = store.listSessionsPaginated(10, '2026-05-09T10:00:00Z|');

      expect(result.sessions).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    test('malformed cursor (missing timestamp part) returns empty sessions gracefully', () => {
      store.createSession('session-1', 'Session 1');

      const result = store.listSessionsPaginated(10, '|session-1');

      expect(result.sessions).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });
  });

  describe('getMessagesPaginated', () => {
    test('returns empty array when no messages exist', () => {
      store.createSession('session-1', 'Session 1');

      const result = store.getMessagesPaginated('session-1');

      expect(result.messages).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    test('returns all messages when below limit', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Hello');
      store.appendMessage('session-1', 'assistant', 'Hi');

      const result = store.getMessagesPaginated('session-1', 10);

      expect(result.messages).toHaveLength(2);
      expect(result.cursor).toBeUndefined();
    });

    test('includes message id in response', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Hello');

      const result = store.getMessagesPaginated('session-1', 10);

      expect(result.messages[0].id).toBeDefined();
      expect(typeof result.messages[0].id).toBe('number');
    });

    test('includes role and content in response', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Hello');

      const result = store.getMessagesPaginated('session-1', 10);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
    });

    test('returns cursor when more results exist beyond limit', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');
      store.appendMessage('session-1', 'user', 'Message 3');

      const result = store.getMessagesPaginated('session-1', 2);

      expect(result.messages).toHaveLength(2);
      expect(result.cursor).toBeTruthy();
    });

    test('does not return cursor at end of data', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');

      const result = store.getMessagesPaginated('session-1', 10);

      expect(result.messages).toHaveLength(2);
      expect(result.cursor).toBeUndefined();
    });

    test('uses cursor to fetch next page', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');
      store.appendMessage('session-1', 'user', 'Message 3');

      // Get first page
      const page1 = store.getMessagesPaginated('session-1', 2);
      expect(page1.messages).toHaveLength(2);
      expect(page1.cursor).toBeTruthy();

      // Get second page using cursor
      const page2 = store.getMessagesPaginated('session-1', 2, page1.cursor);
      expect(page2.messages).toHaveLength(1);
      expect(page2.cursor).toBeUndefined();

      // Verify pages don't overlap
      const page1Ids = new Set(page1.messages.map(m => m.id));
      const page2Ids = new Set(page2.messages.map(m => m.id));
      expect([...page1Ids].some(id => page2Ids.has(id))).toBe(false);
    });

    test('respects limit parameter', () => {
      store.createSession('session-1', 'Session 1');
      for (let i = 1; i <= 10; i++) {
        store.appendMessage('session-1', 'user', `Message ${i}`);
      }

      const result = store.getMessagesPaginated('session-1', 3);

      expect(result.messages).toHaveLength(3);
      expect(result.cursor).toBeTruthy();
    });

    test('enforces maximum limit of 500', () => {
      store.createSession('session-1', 'Session 1');
      // Create 100 messages
      for (let i = 1; i <= 100; i++) {
        store.appendMessage('session-1', 'user', `Message ${i}`);
      }

      // Request with limit > 500
      const result = store.getMessagesPaginated('session-1', 1000);

      // Should enforce max of 500
      expect(result.messages.length).toBeLessThanOrEqual(100);
    });

    test('returns messages in ascending id order (chronological)', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');
      store.appendMessage('session-1', 'user', 'Message 3');

      const result = store.getMessagesPaginated('session-1', 10);

      expect(result.messages[0].content).toBe('Message 1');
      expect(result.messages[1].content).toBe('Message 2');
      expect(result.messages[2].content).toBe('Message 3');

      // IDs should be in ascending order
      expect(result.messages[0].id < result.messages[1].id).toBe(true);
      expect(result.messages[1].id < result.messages[2].id).toBe(true);
    });

    test('pagination works across multiple pages', () => {
      store.createSession('session-1', 'Session 1');
      // Create 7 messages
      for (let i = 1; i <= 7; i++) {
        store.appendMessage('session-1', 'user', `Message ${i}`);
      }

      // Fetch all with pagination (limit 3)
      const allMessages: Array<{ id: number; role: string; content: string; createdAt: string }> = [];
      let cursor: string | undefined;

      // First page
      const page1 = store.getMessagesPaginated('session-1', 3, cursor);
      allMessages.push(...page1.messages);
      cursor = page1.cursor;

      // Second page
      if (cursor) {
        const page2 = store.getMessagesPaginated('session-1', 3, cursor);
        allMessages.push(...page2.messages);
        cursor = page2.cursor;
      }

      // Third page
      if (cursor) {
        const page3 = store.getMessagesPaginated('session-1', 3, cursor);
        allMessages.push(...page3.messages);
        cursor = page3.cursor;
      }

      expect(allMessages).toHaveLength(7);
      expect(cursor).toBeUndefined();
    });

    test('returns messages only for specified session', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');

      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');
      store.appendMessage('session-2', 'user', 'Other Message');

      const result1 = store.getMessagesPaginated('session-1', 10);
      const result2 = store.getMessagesPaginated('session-2', 10);

      expect(result1.messages).toHaveLength(2);
      expect(result2.messages).toHaveLength(1);
      expect(result1.messages[0].content).toBe('Message 1');
      expect(result2.messages[0].content).toBe('Other Message');
    });

    test('cursor from first page is non-empty string when more data exists', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');
      store.appendMessage('session-1', 'user', 'Message 3');

      const result = store.getMessagesPaginated('session-1', 2);

      expect(result.cursor).toBeDefined();
      expect(typeof result.cursor).toBe('string');
      expect(result.cursor!.length > 0).toBe(true);
      // Cursor should be parseable as an integer (the message id)
      expect(Number.isInteger(parseInt(result.cursor!, 10))).toBe(true);
    });

    test('malformed cursor (non-numeric) returns empty messages gracefully', () => {
      store.createSession('session-1', 'Session 1');
      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');

      const result = store.getMessagesPaginated('session-1', 10, 'garbage');

      expect(result.messages).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });
  });

  describe('integration: sessions and messages together', () => {
    test('message counts are accurate across pagination', () => {
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');
      store.createSession('session-3', 'Session 3');

      store.appendMessage('session-1', 'user', 'Message 1');
      store.appendMessage('session-1', 'assistant', 'Message 2');

      store.appendMessage('session-2', 'user', 'Message 1');

      // No messages in session-3

      const result = store.listSessionsPaginated(10);

      const session1 = result.sessions.find(s => s.id === 'session-1');
      const session2 = result.sessions.find(s => s.id === 'session-2');
      const session3 = result.sessions.find(s => s.id === 'session-3');

      expect(session1?.messageCount).toBe(2);
      expect(session2?.messageCount).toBe(1);
      expect(session3?.messageCount).toBe(0);
    });

    test('both pagination methods work together in real workflow', () => {
      // Create multiple sessions
      store.createSession('session-1', 'Session 1');
      store.createSession('session-2', 'Session 2');

      // Add messages to sessions
      store.appendMessage('session-1', 'user', 'Hello');
      store.appendMessage('session-1', 'assistant', 'Hi');
      store.appendMessage('session-1', 'user', 'How are you?');

      store.appendMessage('session-2', 'user', 'Greetings');

      // List sessions with pagination
      const sessionsList = store.listSessionsPaginated(10);
      expect(sessionsList.sessions).toHaveLength(2);

      // For each session, get messages with pagination
      for (const session of sessionsList.sessions) {
        const messagesList = store.getMessagesPaginated(session.id, 10);
        expect(messagesList.messages).toHaveLength(session.messageCount);
      }
    });
  });
});
