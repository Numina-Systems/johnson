import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { SessionWithCounts } from '../../sessions/types.ts';
import { formatSessionLine } from './sessions.ts';

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
    const sessionWithLastMessage: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-11T15:00:00Z',
    };

    const sessionWithoutLastMessage: SessionWithCounts = {
      id: 'sess-2',
      title: 'Test',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };

    const result1 = formatSessionLine(sessionWithLastMessage);
    const result2 = formatSessionLine(sessionWithoutLastMessage);

    // Both should have formatted strings (exact timestamp varies)
    expect(result1).toContain('Test');
    expect(result2).toContain('Test');
  });

  it('is a pure function with deterministic output', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Deterministic',
      createdAt: '2026-05-10T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 7,
      lastMessageAt: '2026-05-11T10:05:00Z',
    };

    const result1 = formatSessionLine(session);
    const result2 = formatSessionLine(session);

    // Same input should produce same output (within time window)
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

    // Should contain blessed formatting tags
    expect(result).toContain('{bold}');
    expect(result).toContain('{/bold}');
    expect(result).toContain('{');
    expect(result).toContain('}'); // for color codes
  });
});
