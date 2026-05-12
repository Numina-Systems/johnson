// pattern: Functional Core — prune view tests

import { describe, it, expect, beforeEach } from 'bun:test';
import type { SessionWithCounts } from '../../sessions/types.ts';
import { formatPruneLine } from './prune.ts';
import { palette } from '../theme.ts';

describe('formatPruneLine', () => {
  it('shows checkbox as [✓] when selected', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test Session',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 5,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', true);

    expect(line).toContain('[✓]');
    expect(line).toContain('Test Session');
  });

  it('shows checkbox as [ ] when not selected', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test Session',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T10:00:00Z',
      messageCount: 5,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', false);

    expect(line).toContain('[ ]');
    expect(line).toContain('Test Session');
  });

  it('includes delete classification with red color tag', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Old Session',
      createdAt: '2026-05-01T10:00:00Z',
      updatedAt: '2026-05-01T10:00:00Z',
      messageCount: 0,
      lastMessageAt: null,
    };

    const line = formatPruneLine(session, 'delete', false);

    expect(line).toContain('delete');
    expect(line).toContain('{red-fg}');
  });

  it('includes archive classification with peach color tag', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Old Session',
      createdAt: '2026-05-01T10:00:00Z',
      updatedAt: '2026-05-08T10:00:00Z',
      messageCount: 5,
      lastMessageAt: '2026-05-08T10:00:00Z',
    };

    const line = formatPruneLine(session, 'archive', false);

    expect(line).toContain('archive');
    expect(line).toContain('{peach-fg}');
  });

  it('includes active classification with green color tag', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'New Session',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T14:00:00Z',
      messageCount: 3,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', false);

    expect(line).toContain('active');
    expect(line).toContain('{green-fg}');
  });

  it('shows message count in parentheses', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T14:00:00Z',
      messageCount: 7,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', false);

    expect(line).toContain('(7 msgs)');
  });

  it('includes relative timestamp', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: 'Test',
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T14:00:00Z',
      messageCount: 1,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', false);

    // Should contain some time indicator
    expect(line).toMatch(/ago|recently/i);
  });

  it('handles null title gracefully', () => {
    const session: SessionWithCounts = {
      id: 'sess-1',
      title: null,
      createdAt: '2026-05-11T10:00:00Z',
      updatedAt: '2026-05-11T14:00:00Z',
      messageCount: 2,
      lastMessageAt: '2026-05-11T14:00:00Z',
    };

    const line = formatPruneLine(session, 'active', false);

    expect(line).toBeDefined();
    expect(line.length).toBeGreaterThan(0);
  });
});
