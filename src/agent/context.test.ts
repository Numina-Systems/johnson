import { describe, expect, test } from 'bun:test';
import { estimateMessageTokens, estimateMessagesTokens, estimateTokens, trimOldToolResults } from './context.ts';
import type { Message } from '../model/types.ts';

function base64OfLength(n: number): string {
  return 'A'.repeat(n);
}

describe('estimateMessageTokens', () => {
  test('string content estimates at length / 4', () => {
    const msg: Message = { role: 'user', content: 'a'.repeat(400) };
    expect(estimateMessageTokens(msg)).toBe(100);
  });

  test('base64 image blocks cost a fixed amount, not length / 4', () => {
    const bigImage = base64OfLength(200_000); // ~50k tokens if counted as text
    const msg: Message = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: [
            { type: 'text', text: 'here is the image' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigImage } },
          ],
        },
      ],
    };

    const estimate = estimateMessageTokens(msg);
    expect(estimate).toBeLessThan(2000);
    expect(estimate).toBeGreaterThan(estimateTokens('here is the image'));
  });

  test('image_url blocks cost the fixed image amount', () => {
    const msg: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
      ],
    };
    expect(estimateMessageTokens(msg)).toBe(estimateTokens('look') + 1600);
  });

  test('tool_use blocks estimate from serialized size', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'execute_code', input: { code: 'output(1)' } }],
    };
    expect(estimateMessageTokens(msg)).toBeGreaterThan(0);
  });

  test('estimateMessagesTokens sums across messages', () => {
    const msgs: Array<Message> = [
      { role: 'user', content: 'a'.repeat(40) },
      { role: 'assistant', content: 'b'.repeat(80) },
    ];
    expect(estimateMessagesTokens(msgs)).toBe(10 + 20);
  });
});

describe('trimOldToolResults preserveCount option', () => {
  function toolResultMessage(id: string, size: number): Message {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(size) }],
    };
  }

  test('default preserves the 8 most recent messages', () => {
    const msgs: Array<Message> = Array.from({ length: 10 }, (_, i) => toolResultMessage(`t${i}`, 1000));
    const trimmed = trimOldToolResults(msgs);
    expect(trimmed).toBe(2);
  });

  test('smaller preserveCount trims more aggressively', () => {
    const msgs: Array<Message> = Array.from({ length: 10 }, (_, i) => toolResultMessage(`t${i}`, 1000));
    const trimmed = trimOldToolResults(msgs, { preserveCount: 4 });
    expect(trimmed).toBe(6);

    const early = msgs[0]!.content as Array<{ type: string; content?: string }>;
    expect(early[0]!.content).toContain('trimmed for context savings');

    const recent = msgs[9]!.content as Array<{ type: string; content?: string }>;
    expect(recent[0]!.content).toBe('x'.repeat(1000));
  });
});
