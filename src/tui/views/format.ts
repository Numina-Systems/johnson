// pattern: Functional Core — message formatting for chat display with syntax highlighting

import { palette, blessedStyles } from '../theme.ts';
import { highlightMarkdown } from '../syntax.ts';

export type DisplayMessage = {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
};

/**
 * Convert store role strings to display roles.
 * - 'assistant' → 'agent'
 * - 'user' → 'user'
 * - anything else → 'system'
 */
export function mapStoreRole(role: string): 'user' | 'agent' | 'system' {
  if (role === 'assistant') return 'agent';
  if (role === 'user') return 'user';
  return 'system';
}

/**
 * Format a single message as a blessed tagged string for display.
 * User messages: lavender "you>" prefix
 * Agent messages: green "agent>" prefix with syntax highlighting
 * System messages: yellow "[system]" prefix
 */
export function formatMessage(msg: DisplayMessage): string {
  switch (msg.role) {
    case 'user':
      return `{bold}{${blessedStyles.userMsg.fg}-fg}you>{/} ${msg.text}`;

    case 'agent': {
      const highlighted = highlightMarkdown(msg.text);
      return `{bold}{${blessedStyles.agentMsg.fg}-fg}agent>{/} ${highlighted}`;
    }

    case 'system':
      return `{${blessedStyles.systemMsg.fg}-fg}[system] ${msg.text}{/}`;
  }
}

/**
 * Format a complete message history by joining all messages with double newlines
 * for blank line separation between adjacent messages.
 */
export function formatMessageHistory(messages: ReadonlyArray<DisplayMessage>): string {
  return messages.map(msg => formatMessage(msg)).join('\n\n');
}
