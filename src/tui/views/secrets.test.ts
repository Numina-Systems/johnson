import { describe, it, expect } from 'bun:test';
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
