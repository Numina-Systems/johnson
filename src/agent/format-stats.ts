// pattern: Functional Core — format ChatStats into a compact status line

import type { ChatStats } from './types.ts';

/**
 * Format token count with k/M suffix for readability.
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format ChatStats into a compact one-line summary.
 * Example: "ctx 7.3k/131.1k (6%) · in 13.2k · out 714 · calls 2 · 4.2s"
 */
export function formatStats(stats: ChatStats): string {
  const ctxPct = Math.round((stats.contextEstimate / stats.contextLimit) * 100);
  const secs = (stats.durationMs / 1000).toFixed(1);

  return [
    `ctx ${fmtTokens(stats.contextEstimate)}/${fmtTokens(stats.contextLimit)} (${ctxPct}%)`,
    `in ${fmtTokens(stats.inputTokens)}`,
    `out ${fmtTokens(stats.outputTokens)}`,
    `calls ${stats.rounds}`,
    `${secs}s`,
  ].join(' · ');
}
