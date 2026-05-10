// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import {
  slugify,
  buildArchiveRkey,
  classifySession,
  formatArchiveDocument,
} from './archive.ts';
import type { SessionWithCounts } from './types.ts';
import type { Message } from '../model/types.ts';

describe('slugify', () => {
  test('session-mgmt.AC2.1: converts "Email Digest" to "email-digest"', () => {
    const result = slugify('Email Digest');
    expect(result).toBe('email-digest');
  });

  test('session-mgmt.AC2.2: returns "untitled" for null input', () => {
    const result = slugify(null);
    expect(result).toBe('untitled');
  });

  test('session-mgmt.AC2.2: returns "untitled" for empty string', () => {
    const result = slugify('');
    expect(result).toBe('untitled');
  });

  test('session-mgmt.AC2.3: strips non-alphanumeric chars and collapses hyphens', () => {
    const result = slugify('---Hello!! World---');
    expect(result).toBe('hello-world');
  });

  test('session-mgmt.AC2.3: handles whitespace and special characters', () => {
    const result = slugify('Test@#$%^&*()_+=-[]{}|;:",.<>?/\\');
    expect(result).toBe('test');
  });

  test('session-mgmt.AC2.3: collapses consecutive hyphens into single hyphen', () => {
    const result = slugify('foo---bar');
    expect(result).toBe('foo-bar');
  });

  test('session-mgmt.AC2.3: trims leading and trailing hyphens', () => {
    const result = slugify('-leading and trailing-');
    expect(result).toBe('leading-and-trailing');
  });

  test('handles whitespace-only input as untitled', () => {
    const result = slugify('   ');
    expect(result).toBe('untitled');
  });

  test('session-mgmt.AC2.3: returns "untitled" for all-special-character input', () => {
    const result = slugify('!@#$%^&*()');
    expect(result).toBe('untitled');
  });

  test('handles input with only hyphens as untitled', () => {
    const result = slugify('---');
    expect(result).toBe('untitled');
  });
});

describe('buildArchiveRkey', () => {
  test('session-mgmt.AC2.4: constructs rkey with slug and formatted datetime', () => {
    const result = buildArchiveRkey('Email Digest', '2026-05-10T14:30:00Z');
    expect(result).toBe('archive:session:email-digest:2026-05-10T14-30');
  });

  test('session-mgmt.AC2.4: handles null title as "untitled" slug', () => {
    const result = buildArchiveRkey(null, '2026-05-10T14:30:00Z');
    expect(result).toBe('archive:session:untitled:2026-05-10T14-30');
  });

  test('formats datetime correctly with hyphens replacing colons', () => {
    const result = buildArchiveRkey('Test', '2026-01-01T00:00:00Z');
    expect(result).toBe('archive:session:test:2026-01-01T00-00');
  });

  test('handles different datetime formats', () => {
    const result = buildArchiveRkey('Note', '2026-12-25T23:59:59Z');
    expect(result).toBe('archive:session:note:2026-12-25T23-59');
  });
});

describe('classifySession', () => {
  test('session-mgmt.AC2.5: returns "delete" for 0 messages, 25 hours old', () => {
    const now = new Date('2026-05-11T12:00:00Z');
    const updatedAt = new Date('2026-05-10T11:00:00Z').toISOString(); // 25 hours ago
    const result = classifySession(0, updatedAt, now);
    expect(result).toBe('delete');
  });

  test('session-mgmt.AC2.7: returns "active" for 0 messages but only 23 hours old', () => {
    const now = new Date('2026-05-11T12:00:00Z');
    const updatedAt = new Date('2026-05-10T13:00:00Z').toISOString(); // 23 hours ago
    const result = classifySession(0, updatedAt, now);
    expect(result).toBe('active');
  });

  test('session-mgmt.AC2.6: returns "archive" for 10 messages, 4 days old', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const updatedAt = new Date('2026-05-10T12:00:00Z').toISOString(); // 4 days ago
    const result = classifySession(10, updatedAt, now);
    expect(result).toBe('archive');
  });

  test('session-mgmt.AC2.7: returns "active" for 5 messages, 1 hour old', () => {
    const now = new Date('2026-05-10T13:00:00Z');
    const updatedAt = new Date('2026-05-10T12:00:00Z').toISOString(); // 1 hour ago
    const result = classifySession(5, updatedAt, now);
    expect(result).toBe('active');
  });

  test('session-mgmt.AC2.7: returns "active" for messages present but only 2 days old', () => {
    const now = new Date('2026-05-12T12:00:00Z');
    const updatedAt = new Date('2026-05-10T12:00:00Z').toISOString(); // 2 days ago
    const result = classifySession(3, updatedAt, now);
    expect(result).toBe('active');
  });

  test('handles boundary case: 0 messages exactly 24 hours old', () => {
    const now = new Date('2026-05-11T12:00:00Z');
    const updatedAt = new Date('2026-05-10T12:00:00Z').toISOString(); // exactly 24 hours
    const result = classifySession(0, updatedAt, now);
    expect(result).toBe('active'); // not yet over 24 hours
  });

  test('handles boundary case: messages exactly 3 days old', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const updatedAt = new Date('2026-05-10T12:00:00Z').toISOString(); // exactly 3 days
    const result = classifySession(5, updatedAt, now);
    expect(result).toBe('active'); // not yet over 3 days
  });
});

describe('formatArchiveDocument', () => {
  test('session-mgmt.AC2.8: includes YAML frontmatter with proper delimiters', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test Session',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-10T12:00:00Z',
    };
    const messages: ReadonlyArray<Message> = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const archivedAt = '2026-05-10T15:00:00Z';

    const result = formatArchiveDocument(meta, messages, archivedAt);

    expect(result).toContain('---');
    expect(result).toContain('title: Test Session');
    expect(result).toContain('archived: 2026-05-10T15:00:00Z');
    expect(result).toContain('session_date_range: 2026-05-10T10:00:00Z – 2026-05-10T12:00:00Z');
    expect(result).toContain('message_count: 2');
  });

  test('session-mgmt.AC2.8: includes summary section when provided', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 1,
      lastMessageAt: '2026-05-10T12:00:00Z',
    };
    const messages: ReadonlyArray<Message> = [{ role: 'user', content: 'Hello' }];
    const summary = 'This was a brief conversation about greetings.';

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z', summary);

    expect(result).toContain('## Summary');
    expect(result).toContain('This was a brief conversation about greetings.');
  });

  test('session-mgmt.AC2.8: omits summary section when not provided', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 1,
      lastMessageAt: '2026-05-10T12:00:00Z',
    };
    const messages: ReadonlyArray<Message> = [{ role: 'user', content: 'Hello' }];

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z');

    expect(result).not.toContain('## Summary');
    expect(result).toContain('## Transcript');
  });

  test('session-mgmt.AC2.8: includes transcript section with formatted conversation', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-10T12:00:00Z',
    };
    const messages: ReadonlyArray<Message> = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z');

    expect(result).toContain('## Transcript');
    expect(result).toContain('### user');
    expect(result).toContain('Hello');
    expect(result).toContain('### assistant');
    expect(result).toContain('Hi');
  });

  test('handles null title as "Untitled" in frontmatter', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: null,
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };
    const messages: ReadonlyArray<Message> = [];

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z');

    expect(result).toContain('title: Untitled');
  });

  test('uses lastMessageAt when available for date range', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 1,
      lastMessageAt: '2026-05-10T11:30:00Z',
    };
    const messages: ReadonlyArray<Message> = [{ role: 'user', content: 'Test' }];

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z');

    expect(result).toContain('session_date_range: 2026-05-10T10:00:00Z – 2026-05-10T11:30:00Z');
  });

  test('uses updatedAt when lastMessageAt is null', () => {
    const meta: SessionWithCounts = {
      id: 'session-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-10T12:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };
    const messages: ReadonlyArray<Message> = [];

    const result = formatArchiveDocument(meta, messages, '2026-05-10T15:00:00Z');

    expect(result).toContain('session_date_range: 2026-05-10T10:00:00Z – 2026-05-10T12:00:00Z');
  });
});
