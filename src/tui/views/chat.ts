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
    height: 'shrink',
    bottom: 3,
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
    border: 'top',
  }) as Widgets.TextareaElement;

  // Create status bar
  const statusBar = createStatusBar({ parent: container });

  // Internal state
  const messages: DisplayMessage[] = [];
  let currentSessionId: string | null = null;
  let isThinking = false;

  // Load messages from store when session is selected
  function loadSession(): void {
    if (!currentSessionId) return;

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

    // Add user message to history
    const userMsg: DisplayMessage = { role: 'user', text };
    appendMessage(userMsg);

    // Persist to store
    if (currentSessionId) {
      store.appendMessage(currentSessionId, 'user', text);
    }

    // Check for commands
    if (text.startsWith('/')) {
      handleCommand(text);
      return;
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
        screen.render();
      }
    );
  }

  // Handle special commands
  function handleCommand(command: string): void {
    if (command === '/reset' || command === '/reset ') {
      agent.reset();
      messages.length = 0;

      if (currentSessionId) {
        store.clearMessages(currentSessionId);
      }

      const systemMsg: DisplayMessage = { role: 'system', text: 'History cleared' };
      appendMessage(systemMsg);
      statusBar.setText('Ready');
    } else if (command === '/help' || command === '/help ') {
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
    } else if (command === '/quit' || command === '/exit' || command === '/quit ' || command === '/exit ') {
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
      textarea.destroy();
      container.destroy();
      bus.removeAllListeners('session:selected');
    },
  };
}
