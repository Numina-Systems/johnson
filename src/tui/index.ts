// pattern: Imperative Shell — neo-blessed screen entry point
// Replaces Ink-based React rendering with neo-blessed screen initialization

import { EventEmitter } from 'events';
import blessed from 'neo-blessed';
import type { TuiDependencies, ScreenView } from './types.ts';
import { createTabBar } from './tab-bar.ts';
import { palette } from './theme.ts';
import { createSessionsView } from './views/sessions.ts';
import { createChatView } from './views/chat.ts';
import { createToolsView } from './views/tools.ts';
import { createSecretsView } from './views/secrets.ts';
import { createSchedulesView } from './views/schedules.ts';
import { createSystemPromptView } from './views/system-prompt.ts';
import { createPruneView } from './views/prune.ts';
import { buildSystemPrompt } from '../agent/prompt.ts';

export type { TuiDependencies };

/**
 * Initialize and render the blessed-based TUI application.
 * Call this from the imperative shell (src/index.ts).
 */
export function startTUI(deps: TuiDependencies): void {
  // Create blessed screen with Catppuccin Macchiato styling
  const screen = blessed.screen({
    smartCSR: true,
    title: 'constellation',
    mouse: true,
    style: {
      bg: palette.base,
    },
  });

  // Typed event bus for cross-view communication
  const bus = new EventEmitter();

  // Define tab labels (7 tabs in order)
  const tabLabels = ['Sessions', 'Chat', 'Tools', 'Secrets', 'Schedules', 'Prompt', 'Prune'] as const;
  let activeTabIndex = 0;

  // Create the Sessions view (real implementation)
  const sessionsView = createSessionsView({
    screen,
    store: deps.store,
    bus,
    onSelectSession(sessionId: string): void {
      // Emit event for other views, then switch to Chat tab (index 1)
      bus.emit('session:selected', { sessionId });
      switchTab(1);
    },
    onNewSession(): void {
      // Emit event to trigger session list refresh
      bus.emit('session:changed');
    },
  });

  // Create the Chat view (Phase 4)
  const chatView = createChatView({
    screen,
    agent: deps.agent,
    store: deps.store,
    bus,
  });

  // Create the Tools view (Phase 5)
  const toolsView = createToolsView({
    screen,
    store: deps.store,
    secrets: deps.secrets,
    customTools: deps.customTools,
    builtinTools: deps.builtinTools,
  });

  // Create the Secrets view (Phase 5)
  const secretsView = createSecretsView({
    screen,
    secrets: deps.secrets,
    store: deps.store,
    customTools: deps.customTools,
  });

  // Create the Schedules view (Phase 5)
  const schedulesView = createSchedulesView({
    screen,
    scheduler: deps.scheduler,
  });

  // Construct getSystemPrompt callback for SystemPrompt view
  async function getSystemPrompt(): Promise<string> {
    if (!deps.timezone) {
      return 'System prompt unavailable: timezone not provided.';
    }
    const selfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
    const allDocs = deps.store.docList(500);
    const skillNames = allDocs.documents
      .filter((d) => d.rkey.startsWith('skill:'))
      .map((d) => d.rkey);
    const customToolSummaries = deps.customTools?.getApprovedToolSummaries();
    const secretNames = deps.secrets?.listKeys();
    return buildSystemPrompt({
      selfDoc,
      skillNames,
      toolDocs: deps.toolDocs ?? '',
      timezone: deps.timezone,
      customToolSummaries,
      secretNames,
      nativeToolNames: deps.builtinTools?.map((t) => t.name),
    });
  }

  // Create the SystemPrompt view (Phase 6)
  const systemPromptView = createSystemPromptView({ screen, getSystemPrompt });

  // Create the Prune view (Phase 6)
  const pruneView = createPruneView({ screen, store: deps.store });

  // Set up views array: index corresponds to tab index
  const views: Array<ScreenView> = [
    sessionsView, // 0: Sessions
    chatView, // 1: Chat (Phase 4)
    toolsView, // 2: Tools (Phase 5)
    secretsView, // 3: Secrets (Phase 5)
    schedulesView, // 4: Schedules (Phase 5)
    systemPromptView, // 5: SystemPrompt (Phase 6)
    pruneView, // 6: Prune (Phase 6)
  ];

  function switchTab(newIndex: number): void {
    if (newIndex < 0 || newIndex >= views.length) return;

    // Hide current view
    const currentView = views[activeTabIndex];
    if (currentView) {
      currentView.hide();
    }

    // Switch index and show new view
    activeTabIndex = newIndex;
    const newView = views[activeTabIndex];
    if (newView) {
      newView.show();
      newView.focus();
    }

    // Update tab bar and clear activity indicator for newly active tab
    tabBar.setActive(newIndex);
    tabBar.setActivity(tabLabels[newIndex], false);
  }

  // Create tab bar
  const tabBar = createTabBar({
    screen,
    labels: Array.from(tabLabels),
    onSwitch: switchTab,
  });

  // Initial view setup: show Sessions, hide others
  for (let i = 0; i < views.length; i++) {
    if (i === 0) {
      views[i]?.show();
      views[i]?.focus();
    } else {
      views[i]?.hide();
    }
  }
  tabBar.setActive(0);

  // Screen-level key bindings
  screen.key(['tab'], () => {
    // Cycle to next tab (with wrapping)
    const nextIndex = (activeTabIndex + 1) % tabLabels.length;
    switchTab(nextIndex);
  });

  screen.key(['S-tab'], () => {
    // Cycle to previous tab (with wrapping)
    const prevIndex = (activeTabIndex - 1 + tabLabels.length) % tabLabels.length;
    switchTab(prevIndex);
  });

  screen.key(['escape'], () => {
    // Switch to Sessions tab (index 0)
    switchTab(0);
  });

  screen.key(['q'], () => {
    // Quit cleanly (only when not capturing input in any view)
    const currentView = views[activeTabIndex];
    if (currentView && currentView.isCapturingInput) {
      return; // Don't quit if a view is capturing input (e.g., confirmation dialog)
    }
    // Clean up all views
    for (const view of views) {
      view?.destroy();
    }
    screen.destroy();
    process.exit(0);
  });

  screen.key(['C-c'], () => {
    // Always quit on Ctrl+C (universally expected)
    for (const view of views) {
      view?.destroy();
    }
    screen.destroy();
    process.exit(0);
  });

  // Listen for tab:activity events (views emitting when updated while hidden)
  bus.on('tab:activity', (data: { tab: string }) => {
    // Only show activity if this tab is not the active one
    if (tabLabels[activeTabIndex] !== data.tab) {
      tabBar.setActivity(data.tab, true);
      screen.render();
    }
  });

  // Listen for screen resize events
  screen.on('resize', () => {
    screen.render();
  });

  // Final render
  screen.render();
}
