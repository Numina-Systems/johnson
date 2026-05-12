import { describe, it, expect } from 'bun:test';
import type { GrantRow } from '../../store/store.ts';
import { formatGrantIcon, formatCustomToolStatus } from './tools.ts';
import { palette } from '../theme.ts';

describe('formatGrantIcon', () => {
  it('returns green checkmark for granted status', () => {
    const result = formatGrantIcon('granted', palette);
    expect(result).toContain('✓');
    expect(result).toContain(palette.green);
  });

  it('returns yellow circle for pending status', () => {
    const result = formatGrantIcon('pending', palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });

  it('returns red X for revoked status', () => {
    const result = formatGrantIcon('revoked', palette);
    expect(result).toContain('✗');
    expect(result).toContain(palette.red);
  });

  it('returns yellow circle for no grant (undefined)', () => {
    const result = formatGrantIcon(undefined, palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });
});

describe('formatCustomToolStatus', () => {
  it('returns green checkmark for approved tools', () => {
    const result = formatCustomToolStatus(true, palette);
    expect(result).toContain('✓');
    expect(result).toContain(palette.green);
  });

  it('returns yellow circle for not approved tools', () => {
    const result = formatCustomToolStatus(false, palette);
    expect(result).toContain('○');
    expect(result).toContain(palette.peach);
  });
});
