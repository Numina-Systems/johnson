import { describe, it, expect, beforeEach, mock } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { GrantRow, Store } from '../../store/store.ts';
import type { CustomToolManager } from '../../tools/custom-tool-manager.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import { createToolsView } from './tools.ts';
import { formatGrantIcon, formatCustomToolStatus } from './tools.ts';
import { palette } from '../theme.ts';

describe('formatGrantIcon', () => {
  it('returns green checkmark for granted status', () => {
    const result = formatGrantIcon('granted', palette);
    expect(result).toContain('✓');
    expect(result).toContain(palette.green);
  });

  it('returns yellow circle for pending status', () => {
    const result = formatGrantIcon('pending', palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });

  it('returns red X for revoked status', () => {
    const result = formatGrantIcon('revoked', palette);
    expect(result).toContain('✗');
    expect(result).toContain(palette.red);
  });

  it('returns yellow circle for no grant (undefined)', () => {
    const result = formatGrantIcon(undefined, palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });
});

describe('formatCustomToolStatus', () => {
  it('returns green checkmark for approved tools', () => {
    const result = formatCustomToolStatus(true, palette);
    expect(result).toContain('✓');
    expect(result).toContain(palette.green);
  });

  it('returns yellow circle for not approved tools', () => {
    const result = formatCustomToolStatus(false, palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });
});

// C3 fix: Add integration tests for interactive behavior
describe('createToolsView - integration', () => {
  let screen: Widgets.Screen;
  let mockStore: Partial<Store>;
  let mockSecrets: Partial<SecretManager>;
  let mockCustomTools: Partial<CustomToolManager>;

  beforeEach(() => {
    // Create screen
    screen = blessed.screen({
      mouse: true,
      keyboard: true,
      smartCSR: true,
    });

    // Mock Store
    mockStore = {
      docList: () => ({ documents: [] }),
      getGrant: () => undefined,
      listGrants: () => [],
      updateGrantStatus: () => {},
      updateGrantSecrets: () => {},
      docDelete: () => {},
      deleteGrant: () => {},
    };

    // Mock SecretManager
    mockSecrets = {
      listKeys: () => [],
    };

    // Mock CustomToolManager
    mockCustomTools = {
      listTools: () => [],
      approveTool: () => {},
      revokeTool: () => {},
      updateSecrets: () => {},
    };
  });

  it('creates view with mocks and renders correctly', () => {
    const view = createToolsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
      builtinTools: [],
    });

    expect(view).toBeDefined();
    expect(view.name).toBe('Tools');
    expect(view.container).toBeDefined();
    expect(view.isCapturingInput).toBe(false);
  });

  it('isCapturingInput is false in list mode', () => {
    const view = createToolsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
      builtinTools: [],
    });

    expect(view.isCapturingInput).toBe(false);
  });

  it('renders all three sections without error', () => {
    const view = createToolsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
      builtinTools: [{ name: 'test-tool', description: 'A test tool' }],
    });

    // Verify view structure
    expect(view.container.children?.length).toBeGreaterThan(0);
    // Should have: section header, custom list, builtin list, skills list, code viewer, status bar
    expect(view.container.children?.length).toBeGreaterThanOrEqual(6);
  });

  it('g key on skills section calls updateGrantStatus with granted', () => {
    const updateGrantStatus = mock(() => {});
    mockStore.updateGrantStatus = updateGrantStatus;
    mockStore.docList = () => ({
      documents: [
        { rkey: 'skill:test-skill', content: '// Skill: test-skill\n// Description: A test skill\ncode here' },
      ],
    });
    mockStore.getGrant = () => ({ skillName: 'skill:test-skill', contentHash: 'abc', status: 'pending' as const, secrets: [], createdAt: new Date().toISOString() });

    const view = createToolsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
      builtinTools: [],
    });

    // Navigate to skills section (index 2) by pressing right twice
    view.container.emit('key right', 'r', { name: 'right', full: 'right' });
    view.container.emit('key right', 'r', { name: 'right', full: 'right' });

    // Press g to grant
    view.container.emit('key g', 'g', { name: 'g', full: 'g' });

    expect(updateGrantStatus.mock.calls.length).toBe(1);
    expect(updateGrantStatus.mock.calls[0][0]).toBe('skill:test-skill');
    expect(updateGrantStatus.mock.calls[0][1]).toBe('granted');
  });

  it('section cycling wraps correctly (right at 2 wraps to 0)', () => {
    const view = createToolsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
      builtinTools: [],
    });

    // Right 3 times wraps back to 0
    view.container.emit('key right', 'r', { name: 'right', full: 'right' });
    view.container.emit('key right', 'r', { name: 'right', full: 'right' });
    view.container.emit('key right', 'r', { name: 'right', full: 'right' });

    // g key should NOT call updateGrantStatus since we're back at section 0
    const updateGrantStatus = mock(() => {});
    mockStore.updateGrantStatus = updateGrantStatus;
    view.container.emit('key g', 'g', { name: 'g', full: 'g' });
    expect(updateGrantStatus.mock.calls.length).toBe(0);
  });
});
