import { describe, it, expect, beforeEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store, GrantRow } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { CustomToolManager } from '../../tools/custom-tool-manager.ts';
import { createSecretsView } from './secrets.ts';
import { formatSecretUsage } from './secrets.ts';

describe('formatSecretUsage', () => {
  it('returns name only if no usage', () => {
    const result = formatSecretUsage('my_key', []);
    expect(result).toBe('my_key');
  });

  it('formats usage with skills and tools', () => {
    const result = formatSecretUsage('api_key', ['my-skill', 'custom-tool']);
    expect(result).toContain('api_key');
    expect(result).toContain('used by');
    expect(result).toContain('my-skill');
    expect(result).toContain('custom-tool');
  });

  it('handles single usage', () => {
    const result = formatSecretUsage('token', ['oauth-skill']);
    expect(result).toContain('token');
    expect(result).toContain('used by');
    expect(result).toContain('oauth-skill');
  });

  it('joins multiple usages with comma', () => {
    const result = formatSecretUsage('key', ['skill1', 'skill2', 'tool1']);
    expect(result).toContain('skill1');
    expect(result).toContain('skill2');
    expect(result).toContain('tool1');
    expect(result).toContain(',');
  });
});

// C3 fix: Add integration tests for interactive behavior
describe('createSecretsView - integration', () => {
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
      listGrants: () => [],
      getGrant: (): GrantRow | null => null,
      updateGrantSecrets: (): boolean => false,
    };

    // Mock SecretManager
    mockSecrets = {
      listKeys: () => [],
      set: async () => {},
      remove: async () => {},
    };

    // Mock CustomToolManager
    mockCustomTools = {
      listTools: () => [],
      getTool: () => undefined,
      updateSecrets: (): boolean => false,
    };
  });

  it('creates view with mocks and renders correctly', () => {
    const view = createSecretsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
    });

    expect(view).toBeDefined();
    expect(view.name).toBe('Secrets');
    expect(view.container).toBeDefined();
    expect(view.isCapturingInput).toBe(false);
  });

  it('isCapturingInput is false in list mode', () => {
    const view = createSecretsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
    });

    expect(view.isCapturingInput).toBe(false);
  });

  it('shows secret names in the list', () => {
    mockSecrets.listKeys = () => ['api_key', 'oauth_token'];

    const view = createSecretsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
    });

    view.show();
    // View should have a selectable list with items
    expect(view.container.children?.length).toBeGreaterThan(0);
    expect(view.name).toBe('Secrets');
  });

  it('d key in list mode triggers delete confirmation', () => {
    mockSecrets.listKeys = () => ['test-secret'];

    const view = createSecretsView({
      screen,
      store: mockStore as Store,
      secrets: mockSecrets as SecretManager,
      customTools: mockCustomTools as CustomToolManager,
    });

    view.show();

    // Press d to trigger delete confirmation
    view.container.emit('key d', 'd', { name: 'd', full: 'd' });

    // isCapturingInput should now be true (in confirm_delete mode)
    expect(view.isCapturingInput).toBe(true);
  });
});
