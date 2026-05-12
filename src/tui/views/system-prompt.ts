// pattern: Imperative Shell — system-prompt view with async prompt loading

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { ScreenView } from '../types.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette } from '../theme.ts';

export type SystemPromptViewOptions = {
  readonly screen: Widgets.Screen;
  readonly getSystemPrompt: () => Promise<string>;
};

export function createSystemPromptView(options: SystemPromptViewOptions): ScreenView {
  const { screen, getSystemPrompt } = options;

  // Main container
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    bottom: 0,
    hidden: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // Header
  const header = blessed.box({
    parent: container,
    top: 0,
    height: 1,
    left: 0,
    width: '100%',
    content: '{bold}System Prompt{/bold}',
    tags: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // ScrollableViewer positioned below header and above status bar
  const viewer = createScrollableViewer({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
  });

  // Status bar
  const statusBar = createStatusBar({ parent: container });
  statusBar.setText('PgUp/PgDn:scroll  g/G:top/bottom  Esc:back');

  // Initially show "Loading..."
  viewer.setContent('Loading...');

  // Load prompt on first show
  let promptLoaded = false;

  return {
    name: 'SystemPrompt',
    container,
    get isCapturingInput(): boolean {
      return false;
    },
    show(): void {
      container.show();

      // Load prompt only once per show
      if (!promptLoaded) {
        promptLoaded = true;
        getSystemPrompt()
          .then((promptText) => {
            viewer.setContent(promptText);
            screen.render();
          })
          .catch((error) => {
            viewer.setContent(`Error loading system prompt: ${(error as Error).message}`);
            screen.render();
          });
      }

      screen.render();
    },
    hide(): void {
      container.hide();
      promptLoaded = false;
      screen.render();
    },
    focus(): void {
      viewer.focus();
    },
    destroy(): void {
      viewer.destroy();
      container.destroy();
    },
  };
}
