// pattern: Imperative Shell — chat view with message history, input, and agent integration

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { EventEmitter } from 'events';
import type { Agent, ChatOptions } from '../../agent/types.ts';
import type { Store } from '../../store/store.ts';
import type { ScreenView } from '../types.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { formatMessage, formatMessageHistory, mapStoreRole } from './format.ts';
import type { DisplayMessage } from './format.ts';

// pattern: Functional Core — pure function for finding matching messages
/**
 * Find indices of messages that match a query string (case-insensitive).
 * Returns empty array if query is empty.
 */
export function findMatches(
  messages: ReadonlyArray<{ text: string }>,
  query: string,
): Array<number> {
  if (!query) return [];
  const lower = query.toLowerCase();
  return messages.reduce<Array<number>>((acc, msg, idx) => {
    if (msg.text.toLowerCase().includes(lower)) acc.push(idx);
    return acc;
  }, []);
}

type ChatViewOptions = {
  readonly screen: Widgets.Screen;
  readonly agent: Agent;
  readonly store: Store;
  readonly bus: EventEmitter;
};

export function createChatView(options: ChatViewOptions): ScreenView {
  const { screen, agent, store, bus } = options;

  // Container box for the entire chat view
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    bottom: 0,
    hidden: true,
    tags: true,
    style: {
      bg: palette.base,
    },
  }) as Widgets.BoxElement;

  // Create scrollable message history viewer
  const viewer = createScrollableViewer({
    parent: container,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-3', // Account for textarea height (1) + margin (1) + status bar (1)
  });

  // Create input textarea for user messages
  const textarea = blessed.textarea({
    parent: container,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    inputOnFocus: true,
    keys: true,
    mouse: true,
    style: {
      fg: blessedStyles.text.fg,
      bg: palette.surface0,
      border: blessedStyles.border,
    },
    border: 'line',
  }) as Widgets.TextareaElement;

  // Create status bar
  const statusBar = createStatusBar({ parent: container });

  // Create search overlay box
  const searchOverlay = blessed.box({
    parent: container,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    hidden: true,
    tags: true,
    border: 'line',
    style: {
      bg: palette.surface0,
      border: {
        fg: blessedStyles.accent.fg,
      },
    },
  }) as Widgets.BoxElement;

  // Create search input textbox (single line)
  const searchInput = blessed.textbox({
    parent: searchOverlay,
    top: 0,
    left: 1,
    width: 'shrink',
    height: 1,
    inputOnFocus: true,
    keys: true,
    mouse: true,
    style: {
      fg: blessedStyles.text.fg,
      bg: palette.surface0,
    },
  }) as Widgets.TextboxElement;

  // Add label to search box
  (searchOverlay as any).setLabel('Search');

  // Internal state
  const messages: Array<DisplayMessage> = [];
  let currentSessionId: string | null = null;
  let isThinking = false;

  // Search state
  let searchVisible = false;
  let searchQuery = '';
  let matchIndices: Array<number> = [];
  let currentMatchIdx = 0;

  // Load messages from store when session is selected
  function loadSession(): void {
    if (!currentSessionId) {
      // No session selected — show empty state
      messages.length = 0;
      viewer.setContent('{dim}Select a session to start chatting{/}');
      return;
    }

    const storedMessages = store.getMessages(currentSessionId, 200);
    messages.length = 0;

    for (const msg of storedMessages) {
      messages.push({
        role: mapStoreRole(msg.role),
        text: msg.content,
      });
    }

    updateDisplay();
  }

  // Update the display with current message history
  function updateDisplay(): void {
    const content = formatMessageHistory(messages);
    viewer.setContent(content);
  }

  // Append a message to history and display
  function appendMessage(msg: DisplayMessage): void {
    messages.push(msg);
    const formatted = formatMessage(msg);
    viewer.appendContent('\n\n' + formatted);
  }

  // Handle textarea Enter key for submission
  function submitMessage(): void {
    const text = textarea.getValue().trim();

    if (!text) {
      return;
    }

    // Clear textarea
    textarea.clearValue();

    // Check for commands before persisting
    if (text.startsWith('/')) {
      handleCommand(text);
      return;
    }

    // Add user message to history
    const userMsg: DisplayMessage = { role: 'user', text };
    appendMessage(userMsg);

    // Persist to store
    if (currentSessionId) {
      store.appendMessage(currentSessionId, 'user', text);
    }

    // Set thinking state and send to agent
    isThinking = true;
    statusBar.setText('Thinking...');

    const chatOptions: ChatOptions = {
      sessionId: currentSessionId || undefined,
      onEvent: async (event) => {
        switch (event.kind) {
          case 'llm_start':
            statusBar.setText('Thinking...');
            break;

          case 'llm_done': {
            const round = event.data['round'];
            statusBar.setText(
              typeof round === 'number' ? `Round ${round} complete` : 'Round complete'
            );
            break;
          }

          case 'tool_start':
            statusBar.setText('Running code...');
            break;

          case 'tool_done': {
            const success = event.data['success'];
            statusBar.setText(success === false ? 'Code error' : 'Code finished');
            break;
          }
        }

        screen.render();
      },
    };

    agent.chat(text, chatOptions).then(
      (result) => {
        // Add agent response to history
        const agentMsg: DisplayMessage = { role: 'agent', text: result.text };
        appendMessage(agentMsg);

        // Persist response to store
        if (currentSessionId) {
          store.appendMessage(currentSessionId, 'assistant', result.text);
        }

        isThinking = false;
        statusBar.setText('Ready');

        // Emit activity event if chat is hidden (for tab bar indicator)
        if (container.hidden) {
          bus.emit('tab:activity', { tab: 'Chat' });
        }

        screen.render();
      },
      (error) => {
        // Add error message to history
        const errorMsg: DisplayMessage = {
          role: 'system',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        };
        appendMessage(errorMsg);

        isThinking = false;
        statusBar.setText('Error');

        // Emit activity event if chat is hidden (for tab bar indicator)
        if (container.hidden) {
          bus.emit('tab:activity', { tab: 'Chat' });
        }

        screen.render();
      }
    );
  }

  // Handle special commands
  function handleCommand(command: string): void {
    if (command === '/reset') {
      agent.reset();
      messages.length = 0;

      if (currentSessionId) {
        store.clearMessages(currentSessionId);
      }

      const systemMsg: DisplayMessage = { role: 'system', text: 'History cleared' };
      appendMessage(systemMsg);
      statusBar.setText('Ready');
    } else if (command === '/help') {
      const helpMsg: DisplayMessage = {
        role: 'system',
        text:
          'Available commands:\n' +
          '  /reset  - Clear conversation history\n' +
          '  /help   - Show this help message\n' +
          '  /quit   - Exit the application\n' +
          '  /exit   - Exit the application',
      };
      appendMessage(helpMsg);
    } else if (command === '/quit' || command === '/exit') {
      process.exit(0);
    } else {
      const unknownMsg: DisplayMessage = {
        role: 'system',
        text: `Unknown command: ${command}. Type /help for available commands.`,
      };
      appendMessage(unknownMsg);
    }

    screen.render();
  }

  // Handle search input changes
  function performSearch(): void {
    searchQuery = searchInput.getValue();
    matchIndices = findMatches(messages, searchQuery);
    currentMatchIdx = 0;

    if (matchIndices.length > 0) {
      // Scroll to first match by estimating its position
      scrollToMessageIndex(matchIndices[0]);
      searchOverlay.setContent(`{#${blessedStyles.accent.fg.replace('#', '')}-fg}${matchIndices.length} match${matchIndices.length === 1 ? '' : 'es'}{/}`);
    } else {
      searchOverlay.setContent(`{#${blessedStyles.text.fg.replace('#', '')}-fg}No matches{/}`);
    }

    screen.render();
  }

  // Calculate scroll position for a given message index and scroll there
  function scrollToMessageIndex(messageIndex: number): void {
    const scrollHeight = (viewer.element as any).getScrollHeight() ?? 0;
    const elementHeight = (viewer.element.height as number) ?? 10;
    if (scrollHeight === 0 || messages.length === 0) {
      return;
    }
    // Estimate position: distribute scroll height evenly across messages
    const estimatedOffset = Math.floor((messageIndex / messages.length) * scrollHeight);
    (viewer.element as any).setScroll(Math.max(0, estimatedOffset - elementHeight / 2));
    const scr = viewer.element.screen;
    if (scr) {
      scr.render();
    }
  }

  // Toggle search overlay
  function toggleSearch(): void {
    if (searchVisible) {
      // Close search
      searchVisible = false;
      searchOverlay.hide();
      searchInput.clearValue();
      searchQuery = '';
      matchIndices = [];
      textarea.focus();
    } else {
      // Open search
      searchVisible = true;
      searchOverlay.show();
      searchInput.focus();
    }

    screen.render();
  }

  // Jump to next match
  function nextMatch(): void {
    if (matchIndices.length === 0) return;
    currentMatchIdx = (currentMatchIdx + 1) % matchIndices.length;
    scrollToMessageIndex(matchIndices[currentMatchIdx]);
    screen.render();
  }

  // Bind container keys (for F5 search activation)
  container.key(['f5'], () => {
    toggleSearch();
  });

  // Bind search input keys
  searchInput.key(['enter'], () => {
    // Enter in search: jump to next match
    nextMatch();
  });

  searchInput.key(['escape'], () => {
    // Escape in search: close search and return to textarea
    toggleSearch();
  });

  searchInput.on('keypress', () => {
    // On each keystroke, update search results
    performSearch();
  });

  // Bind textarea keys
  textarea.key(['enter'], () => {
    if (!isThinking) {
      submitMessage();
    }
  });

  textarea.key(['S-enter'], () => {
    // Insert newline for multi-line input (Shift+Enter)
    const current = textarea.getValue();
    textarea.setValue(current + '\n');
  });

  // Bind F5 on textarea to open search
  textarea.key(['f5'], () => {
    toggleSearch();
  });

  // Bind Escape to return to Sessions (when not thinking)
  textarea.key(['escape'], () => {
    // Escape should navigate back to Sessions, but that's handled in index.ts
    // via the screen-level key binding
  });

  // Listen for session selection on the bus
  bus.on('session:selected', (data: { sessionId: string }) => {
    currentSessionId = data.sessionId;
    loadSession();
  });

  return {
    name: 'Chat',
    container,
    get isCapturingInput(): boolean {
      return true;
    },
    show(): void {
      container.show();
      loadSession();
      textarea.focus();
      screen.render();
    },
    hide(): void {
      container.hide();
      screen.render();
    },
    focus(): void {
      textarea.focus();
    },
    destroy(): void {
      viewer.destroy();
      statusBar.destroy();
      searchInput.destroy();
      searchOverlay.destroy();
      textarea.destroy();
      container.destroy();
      bus.removeAllListeners('session:selected');
    },
  };
}
