// pattern: Imperative Shell — session management sandbox tools

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { classifySession } from '../sessions/archive.ts';
import { archiveSession } from '../sessions/archiver.ts';

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === 'string' ? val : undefined;
}

const VALID_FILTERS = new Set(['stale', 'active', 'delete', 'archive']);

export function registerSessionTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  // list_sessions
  registry.register(
    'list_sessions',
    {
      name: 'list_sessions',
      description:
        'List all conversation sessions with metadata and classification. Optionally filter by classification.',
      input_schema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['stale', 'active', 'delete', 'archive'],
            description: 'Optional filter. "stale" returns sessions classified as "delete" or "archive".',
          },
        },
        required: [],
      },
    },
    async (params) => {
      const filter = optStr(params, 'filter');
      if (filter && !VALID_FILTERS.has(filter)) {
        throw new Error(`invalid filter value: ${filter}. Must be one of: stale, active, delete, archive`);
      }

      const sessions = deps.store.listSessionsWithCounts();
      const now = new Date();

      // Add classification to each session
      const sessionsWithClassification = sessions.map((session) => ({
        ...session,
        classification: classifySession(session.messageCount, session.updatedAt, now),
      }));

      // Apply filter if provided
      if (!filter) {
        return sessionsWithClassification;
      }

      if (filter === 'stale') {
        return sessionsWithClassification.filter(
          (s) => s.classification === 'delete' || s.classification === 'archive'
        );
      }

      return sessionsWithClassification.filter((s) => s.classification === filter);
    },
  );

  // archive_session
  registry.register(
    'archive_session',
    {
      name: 'archive_session',
      description:
        'Archive a conversation session. Creates an archive document in the document store and deletes the original session.',
      input_schema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID to archive',
          },
        },
        required: ['session_id'],
      },
    },
    async (params) => {
      const sessionId = str(params, 'session_id');
      const result = await archiveSession(sessionId, deps.store, deps.subAgent, deps.embedding);
      return `Archived session as ${result.rkey}`;
    },
  );

  // delete_session
  registry.register(
    'delete_session',
    {
      name: 'delete_session',
      description:
        'Delete a conversation session and all its messages. This is permanent and cannot be undone.',
      input_schema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID to delete',
          },
        },
        required: ['session_id'],
      },
    },
    async (params) => {
      const sessionId = str(params, 'session_id');
      const deleted = deps.store.deleteSession(sessionId);
      if (!deleted) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return `Deleted session ${sessionId}`;
    },
  );
}
