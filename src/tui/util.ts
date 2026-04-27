// pattern: Functional Core — shared TUI helpers

/**
 * Parse a description from a skill/tool document's header comment.
 * Looks for `// Description: ...` in the first few lines.
 */
export function parseDescription(content: string): string {
  const lines = content.split('\n').slice(0, 10);
  for (const line of lines) {
    const match = line.match(/^\/\/\s*Description:\s*(.+)/i);
    if (match) return match[1]!.trim();
  }
  return '';
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-CA');
}
