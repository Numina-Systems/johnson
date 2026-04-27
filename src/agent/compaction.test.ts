// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import { formatConversation } from './compaction.ts';
import type { Message } from '../model/types.ts';

describe('formatConversation', () => {
  test('includes reasoning_content when present on assistant message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        content: 'The answer is 4.',
        reasoning_content: 'Simple arithmetic: 2+2=4.',
      },
    ];

    const result = formatConversation(messages);

    expect(result).toContain('### assistant (reasoning)');
    expect(result).toContain('Simple arithmetic: 2+2=4.');
    expect(result).toContain('### assistant\nThe answer is 4.');
  });

  test('omits reasoning section when reasoning_content is absent', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const result = formatConversation(messages);

    expect(result).not.toContain('(reasoning)');
    expect(result).toContain('### assistant\nHi there');
  });
});
