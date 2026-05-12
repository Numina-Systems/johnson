import { describe, it, expect, beforeEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { createSystemPromptView } from './system-prompt.ts';

describe('createSystemPromptView', () => {
  let screen: Widgets.Screen;

  beforeEach(() => {
    screen = blessed.screen({ smartCSR: true });
  });

  it('should create a view with proper structure', () => {
    const getSystemPrompt = async () => 'test prompt';
    const view = createSystemPromptView({ screen, getSystemPrompt });

    expect(view.name).toBe('SystemPrompt');
    expect(view.isCapturingInput).toBe(false);
    expect(view.container).toBeDefined();
  });

  it('should call getSystemPrompt when shown', async () => {
    let callCount = 0;
    const getSystemPrompt = async () => {
      callCount++;
      return 'test prompt';
    };
    const view = createSystemPromptView({ screen, getSystemPrompt });

    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callCount).toBe(1);
  });

  it('should only load prompt once per show/hide cycle', async () => {
    let callCount = 0;
    const getSystemPrompt = async () => {
      callCount++;
      return 'test prompt';
    };
    const view = createSystemPromptView({ screen, getSystemPrompt });

    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should only call once during this cycle
    expect(callCount).toBe(1);

    view.hide();
    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // After hide/show cycle, should call again
    expect(callCount).toBe(2);
  });

  it('should have required view methods', () => {
    const getSystemPrompt = async () => 'test';
    const view = createSystemPromptView({ screen, getSystemPrompt });

    expect(typeof view.show).toBe('function');
    expect(typeof view.hide).toBe('function');
    expect(typeof view.focus).toBe('function');
    expect(typeof view.destroy).toBe('function');
  });

  it('should handle getSystemPrompt errors gracefully', async () => {
    const getSystemPrompt = async () => {
      throw new Error('Test error');
    };
    const view = createSystemPromptView({ screen, getSystemPrompt });

    // Should not throw, but handle error internally
    expect(() => {
      view.show();
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // View should remain functional
    expect(view.isCapturingInput).toBe(false);
  });

  it('should set viewer content to the returned prompt text', async () => {
    const promptText = 'This is the system prompt content';
    const getSystemPrompt = async () => promptText;
    const view = createSystemPromptView({ screen, getSystemPrompt });

    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Find the scrollable viewer element (has scrollable: true, distinct from header/status)
    const viewer = view.container.children?.find(
      (child) => (child as any).scrollable === true
    ) as any;
    expect(viewer).toBeDefined();
    expect(viewer.getContent()).toContain(promptText);
  });
});
