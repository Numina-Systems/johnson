// pattern: Functional Core

import type { Message } from '../model/types.ts';
import type { SessionWithCounts, SessionClassification } from './types.ts';
import { formatConversation } from '../agent/compaction.ts';

/**
 * Converts a title to a URL-safe kebab-case slug.
 * - Returns "untitled" for null or empty input
 * - Lowercases the input
 * - Replaces non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens into one
 * - Trims leading/trailing hyphens
 * - Returns "untitled" if the result is empty after transformation
 */
export function slugify(title: string | null): string {
  if (!title || !title.trim()) {
    return 'untitled';
  }

  const result = title
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return result || 'untitled';
}

/**
 * Constructs the rkey for an archive document.
 * Format: archive:session:<slug>:<YYYY-MM-DDTHH-MM>
 */
export function buildArchiveRkey(title: string | null, updatedAt: string): string {
  const slug = slugify(title);
  const date = new Date(updatedAt);
  const iso = date.toISOString();
  const datetime = iso.slice(0, 16).replace(':', '-');
  return `archive:session:${slug}:${datetime}`;
}

/**
 * Classifies a session based on age and message count.
 * - Returns "delete" if no messages and age > 24 hours
 * - Returns "archive" if messages exist and age > 3 days
 * - Returns "active" otherwise
 */
export function classifySession(
  messageCount: number,
  updatedAt: string,
  now: Date,
): SessionClassification {
  const age = now.getTime() - new Date(updatedAt).getTime();

  const TWENTY_FOUR_HOURS = 86_400_000;
  const THREE_DAYS = 259_200_000;

  if (messageCount === 0 && age > TWENTY_FOUR_HOURS) {
    return 'delete';
  }

  if (messageCount > 0 && age > THREE_DAYS) {
    return 'archive';
  }

  return 'active';
}

/**
 * Produces a markdown archive document with YAML frontmatter.
 * Note: The archivedAt parameter must be provided by the caller to maintain
 * Functional Core purity (no new Date() calls inside FC).
 */
export function formatArchiveDocument(
  meta: SessionWithCounts,
  messages: ReadonlyArray<Message>,
  archivedAt: string,
  summary?: string,
): string {
  const title = meta.title ?? 'Untitled';
  const endDate = meta.lastMessageAt ?? meta.updatedAt;

  const sections: Array<string> = [];

  // Build YAML frontmatter
  const frontmatter = [
    '---',
    `title: ${title}`,
    `archived: ${archivedAt}`,
    `session_date_range: ${meta.createdAt} – ${endDate}`,
    `message_count: ${meta.messageCount}`,
    '---',
  ].join('\n');

  sections.push(frontmatter);

  // Add optional summary section
  if (summary) {
    sections.push(`## Summary\n${summary}`);
  }

  // Add transcript section
  sections.push(`## Transcript\n${formatConversation(messages)}`);

  return sections.join('\n\n');
}
