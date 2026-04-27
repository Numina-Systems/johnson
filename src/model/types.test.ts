// pattern: Functional Core (test) — exercises pure helpers from types.ts

import { describe, expect, it } from 'bun:test';
import { toolResultContentToString } from './types.ts';
import type { ToolResultContentBlock } from './types.ts';

describe('toolResultContentToString', () => {
  it('GH03.AC7.1 (string path): returns string content as-is', () => {
    expect(toolResultContentToString('hello world')).toBe('hello world');
    expect(toolResultContentToString('')).toBe('');
  });

  it('GH03.AC7.1 (array with text): joins text blocks with newlines', () => {
    const content: ToolResultContentBlock[] = [
      { type: 'text', text: 'line one' },
      { type: 'text', text: 'line two' },
    ];
    expect(toolResultContentToString(content)).toBe('line one\nline two');
  });

  it('GH03.AC7.1 (array with image): renders image as [image] placeholder', () => {
    const content: ToolResultContentBlock[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
    ];
    expect(toolResultContentToString(content)).toBe('[image]');
  });

  it('GH03.AC7.1 (mixed array): joins text and [image] placeholder with newlines', () => {
    const content: ToolResultContentBlock[] = [
      { type: 'text', text: 'before' },
      { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
      { type: 'text', text: 'after' },
    ];
    expect(toolResultContentToString(content)).toBe('before\n[image]\nafter');
  });

  it('GH03.AC7.1 (empty array): returns empty string', () => {
    expect(toolResultContentToString([])).toBe('');
  });
});
