// pattern: Imperative Shell (test)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createStore } from './store.ts';
import type { Store } from './store.ts';

describe('listSessionsWithCounts', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  test('session-mgmt.AC1.1: returns accurate messageCount for sessions with messages', () => {
    // Create a session
    const sessionId = 'test-session-1';
    store.createSession(sessionId, 'Test Session');

    // Append several messages
    store.appendMessage(sessionId, 'user', 'Hello');
    store.appendMessage(sessionId, 'assistant', 'Hi there');
    store.appendMessage(sessionId, 'user', 'How are you?');

    // Call listSessionsWithCounts
    const results = store.listSessionsWithCounts();

    // Assert messageCount is correct
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(sessionId);
    expect(results[0]!.messageCount).toBe(3);
  });

  test('session-mgmt.AC1.2: session with no messages returns messageCount 0 and lastMessageAt null', () => {
    // Create a session with no messages
    const sessionId = 'empty-session';
    store.createSession(sessionId, 'Empty Session');

    // Call listSessionsWithCounts
    const results = store.listSessionsWithCounts();

    // Assert messageCount is 0 and lastMessageAt is null
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(sessionId);
    expect(results[0]!.messageCount).toBe(0);
    expect(results[0]!.lastMessageAt).toBeNull();
  });

  test('session-mgmt.AC1.3: results ordered by updatedAt DESC', async () => {
    // Create three sessions
    const session1 = 'session-1';
    const session2 = 'session-2';
    const session3 = 'session-3';

    store.createSession(session1, 'Session 1');
    store.createSession(session2, 'Session 2');
    store.createSession(session3, 'Session 3');

    // Update sessions with delays to guarantee distinct timestamps
    store.appendMessage(session1, 'user', 'msg');
    await new Promise(r => setTimeout(r, 10));

    store.appendMessage(session2, 'user', 'msg');
    await new Promise(r => setTimeout(r, 10));

    store.appendMessage(session3, 'user', 'msg');

    // Call listSessionsWithCounts
    const results = store.listSessionsWithCounts();

    // Assert results ordered by updatedAt DESC (session3 last updated should be first)
    expect(results).toHaveLength(3);
    expect(results[0]!.id).toBe(session3);
    expect(results[1]!.id).toBe(session2);
    expect(results[2]!.id).toBe(session1);
  });

  test('session-mgmt.AC1.3: respects limit parameter', () => {
    // Create three sessions
    store.createSession('session-1', 'Session 1');
    store.createSession('session-2', 'Session 2');
    store.createSession('session-3', 'Session 3');

    // Call listSessionsWithCounts with limit 1
    const results = store.listSessionsWithCounts(1);

    // Assert only 1 result returned
    expect(results).toHaveLength(1);
  });

  test('returns empty array when no sessions exist', () => {
    // Call listSessionsWithCounts on empty store
    const results = store.listSessionsWithCounts();

    // Assert empty array
    expect(results).toHaveLength(0);
  });

  test('includes title and timestamps in response', () => {
    const sessionId = 'test-session';
    store.createSession(sessionId, 'My Session');
    store.appendMessage(sessionId, 'user', 'Hello');

    const results = store.listSessionsWithCounts();

    expect(results[0]!.title).toBe('My Session');
    expect(results[0]!.createdAt).toBeTruthy();
    expect(results[0]!.updatedAt).toBeTruthy();
    expect(results[0]!.lastMessageAt).toBeTruthy();
  });

  test('handles null titles', () => {
    const sessionId = 'untitled-session';
    store.createSession(sessionId); // no title

    const results = store.listSessionsWithCounts();

    expect(results[0]!.title).toBeNull();
  });
});

describe('docListByPrefix', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  test('returns only documents matching the prefix, sorted by rkey', () => {
    store.docUpsert('skill:beta', 'b');
    store.docUpsert('skill:alpha', 'a');
    store.docUpsert('context:s1:2026', 'c');
    store.docUpsert('self', 's');

    const skills = store.docListByPrefix('skill:');
    expect(skills.map((d) => d.rkey)).toEqual(['skill:alpha', 'skill:beta']);
  });

  test('is not capped at 500 documents', () => {
    for (let i = 0; i < 600; i++) {
      store.docUpsert(`context:s1:${String(i).padStart(4, '0')}`, `doc ${i}`);
    }

    const docs = store.docListByPrefix('context:s1:');
    expect(docs.length).toBe(600);
  });

  test('treats LIKE wildcards in the prefix literally', () => {
    store.docUpsert('task:a_b', 'underscore');
    store.docUpsert('task:axb', 'x');

    const docs = store.docListByPrefix('task:a_');
    expect(docs.map((d) => d.rkey)).toEqual(['task:a_b']);
  });

  test('longer sessionId prefixes do not leak into shorter ones', () => {
    store.docUpsert('context:abc:2026-01-01', 'one');
    store.docUpsert('context:abcd:2026-01-01', 'two');

    const docs = store.docListByPrefix('context:abc:');
    expect(docs.map((d) => d.rkey)).toEqual(['context:abc:2026-01-01']);
  });
});
