import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { SessionWithCounts } from '../../sessions/types.ts';
import { formatSessionLine } from './sessions.ts';
import { palette } from '../theme.ts';

describe('formatSessionLine', () => {
  it('formats session with title, message count, and relative timestamp', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'My Project',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 5,
      lastMessageAt: '2026-05-11T14:30:00Z',
    };

    const result = formatSessionLine(session);

    expect(result).toContain('My Project');
    expect(result).toContain('(5 msgs)');
    // Timestamp will vary, but should contain a relative time indicator or date
    expect(result).toMatch(/msgs\).*/);
  });

  it('formats session with null title as "Untitled session"', () => {
    const session: SessionWithCounts = {
      id: 'sess-2',
      title: null,
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 3,
      lastMessageAt: '2026-05-11T12:00:00Z',
    };

    const result = formatSessionLine(session);

    expect(result).toContain('Untitled session');
    expect(result).toContain('(3 msgs)');
  });

  it('uses lastMessageAt when available, otherwise createdAt', () => {
    const now = new Date('2026-05-11T20:00:00Z');

    const sessionWithLastMessage: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test',
      createdAt: '2026-05-01T10:00:00Z', // 10 days before now
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-11T15:00:00Z', // 5 hours before now
    };

    const sessionWithoutLastMessage: SessionWithCounts = {
      id: 'sess-2',
      title: 'Test',
      createdAt: '2026-05-11T10:00:00Z', // 10 hours before now
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };

    const result1 = formatSessionLine(sessionWithLastMessage, now);
    const result2 = formatSessionLine(sessionWithoutLastMessage, now);

    // Session with lastMessageAt should show ~5h ago
    expect(result1).toContain('5h ago');
    // Session without lastMessageAt should use createdAt, showing ~10h ago
    expect(result2).toContain('10h ago');
    // Results should be different because they used different timestamps
    expect(result1).not.toEqual(result2);
  });

  it('is a pure function with deterministic output', () => {
    const now = new Date('2026-05-11T12:00:00Z');
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Deterministic',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 7,
      lastMessageAt: '2026-05-11T10:05:00Z',
    };

    const result1 = formatSessionLine(session, now);
    const result2 = formatSessionLine(session, now);

    // Same input (including now) should produce identical output
    expect(result1).toEqual(result2);
  });

  it('handles sessions with 0 messages', () => {
    const session: SessionWithCounts = {
      id: 'sess-empty',
      title: 'Empty Session',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };

    const result = formatSessionLine(session);

    expect(result).toContain('Empty Session');
    expect(result).toContain('(0 msgs)');
  });

  it('handles sessions with many messages', () => {
    const session: SessionWithCounts = {
      id: 'sess-many',
      title: 'Active Session',
      createdAt: '2026-05-01T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 999,
      lastMessageAt: '2026-05-11T10:00:00Z',
    };

    const result = formatSessionLine(session);

    expect(result).toContain('Active Session');
    expect(result).toContain('(999 msgs)');
  });

  it('applies blessed tag formatting for bold title and muted timestamp', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Tagged',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-11T12:00:00Z',
    };

    const result = formatSessionLine(session);

    // Should contain blessed formatting tags for bold
    expect(result).toContain('{bold}');
    expect(result).toContain('{/bold}');
    // Should contain the overlay0 color tag for the timestamp
    expect(result).toContain(`{${palette.overlay0}-fg}`);
    expect(result).toContain('{/}');
  });
});
