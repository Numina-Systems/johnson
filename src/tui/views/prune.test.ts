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
    expect(line).toContain(`{${palette.red}-fg}`);
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
    expect(line).toContain(`{${palette.peach}-fg}`);
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
    expect(line).toContain(`{${palette.green}-fg}`);
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

describe('createPruneView', () => {
  let screen: import('blessed').Widgets.Screen;

  beforeEach(() => {
    screen = require('neo-blessed').screen({ smartCSR: true });
  });

  it('should create a view with proper structure', () => {
    const mockStore = {
      listSessionsWithCounts: () => [],
      deleteSession: () => {},
      archiveSession: () => {},
    } as any;

    const view = require('./prune.ts').createPruneView({ screen, store: mockStore });

    expect(view.name).toBe('Prune');
    expect(view.isCapturingInput).toBe(false);
    expect(view.container).toBeDefined();
  });

  it('should show container and render without error when sessions exist', () => {
    const mockSessions: SessionWithCounts[] = [
      {
        id: 'sess-1',
        title: 'Session 1',
        createdAt: '2026-05-11T10:00:00Z',
        updatedAt: '2026-05-11T14:00:00Z',
        messageCount: 5,
        lastMessageAt: '2026-05-11T14:00:00Z',
      },
      {
        id: 'sess-2',
        title: 'Old Session',
        createdAt: '2026-05-01T10:00:00Z',
        updatedAt: '2026-05-01T10:00:00Z',
        messageCount: 0,
        lastMessageAt: null,
      },
    ];

    const mockStore = {
      listSessionsWithCounts: () => mockSessions,
      deleteSession: () => {},
    } as any;

    const view = require('./prune.ts').createPruneView({ screen, store: mockStore });
    view.show();

    expect(view.container.visible).toBe(true);
  });

  it('should have required ScreenView methods', () => {
    const mockStore = {
      listSessionsWithCounts: () => [],
      deleteSession: () => {},
    } as any;

    const view = require('./prune.ts').createPruneView({ screen, store: mockStore });

    expect(typeof view.show).toBe('function');
    expect(typeof view.hide).toBe('function');
    expect(typeof view.focus).toBe('function');
    expect(typeof view.destroy).toBe('function');
  });

  it('should not capture input in initial select mode', () => {
    const mockStore = {
      listSessionsWithCounts: () => [],
      deleteSession: () => {},
    } as any;

    const view = require('./prune.ts').createPruneView({ screen, store: mockStore });

    expect(view.isCapturingInput).toBe(false);
  });

  it('should capture input after entering confirm mode via Enter with selections', () => {
    const mockSessions: SessionWithCounts[] = [
      {
        id: 'sess-old',
        title: 'Old Empty',
        createdAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:00:00Z',
        messageCount: 0,
        lastMessageAt: null,
      },
    ];

    const mockStore = {
      listSessionsWithCounts: () => mockSessions,
      deleteSession: () => {},
    } as any;

    const view = require('./prune.ts').createPruneView({ screen, store: mockStore });
    view.show();

    // Find the list element (blessed.list has 'selected' property)
    const listEl = view.container.children?.find(
      (child: any) => typeof child.selected === 'number'
    ) as any;
    expect(listEl).toBeDefined();

    // Select the session with Space and press Enter (keys bound on list element)
    listEl.emit('key space', ' ', { name: 'space', full: 'space' });
    listEl.emit('key enter', '\r', { name: 'enter', full: 'enter' });

    // Should now be capturing input in confirm mode
    expect(view.isCapturingInput).toBe(true);
  });
});
