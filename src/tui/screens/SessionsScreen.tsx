// pattern: UI Shell — session list and navigation

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Store } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { TaskStore } from '../../scheduler/types.ts';
import type { TuiDependencies } from '../types.ts';
import { formatDate } from '../util.ts';

type SessionsScreenProps = {
  readonly store: Store;
  readonly modelName: string;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: TuiDependencies['customTools'];
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
};

type SessionRow = {
  readonly id: string;
  readonly title: string | null;
  readonly updatedAt: string;
  readonly messageCount: number;
};

export default function SessionsScreen(props: SessionsScreenProps): React.ReactElement {
  const { store, modelName, secrets, scheduler, customTools, onSelectSession, onNewSession } = props;
  const [sessions, setSessions] = useState<ReadonlyArray<SessionRow>>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const rows = store.listSessions(50).map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      messageCount: store.getSessionMessageCount(s.id),
    }));
    setSessions(rows);
    setSelectedIdx((idx) => Math.min(idx, Math.max(0, rows.length - 1)));
  }, [store, refreshTick]);

  useInput((input, key) => {
    if (sessions.length === 0) {
      if (input === 'n') onNewSession();
      return;
    }

    if (input === 'j' || key.downArrow) {
      setSelectedIdx((idx) => Math.min(idx + 1, sessions.length - 1));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIdx((idx) => Math.max(idx - 1, 0));
    } else if (key.return) {
      const session = sessions[selectedIdx];
      if (session) onSelectSession(session.id);
    } else if (input === 'n') {
      onNewSession();
    } else if (input === 'd') {
      const session = sessions[selectedIdx];
      if (session) {
        store.deleteSession(session.id);
        refresh();
      }
    }
  });

  const secretCount = secrets?.listKeys().length ?? 0;
  const scheduleCount = scheduler?.list().length ?? 0;
  const tools = customTools?.listTools() ?? [];
  const approvedToolCount = tools.filter((t) => t.approved).length;
  const totalToolCount = tools.length;

  return (
    <Box flexDirection="column" height="100%">
      <Box paddingX={1}>
        <Text bold color="white">
          constellation-lite
        </Text>
        <Text color="gray"> — </Text>
        <Text bold color="yellow">
          {modelName}
        </Text>
        <Text color="gray">
          {'  '}secrets:{secretCount} schedules:{scheduleCount} tools:{approvedToolCount}/{totalToolCount}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold>Sessions</Text>
        {sessions.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>No sessions yet. Press n to start a new conversation.</Text>
          </Box>
        ) : (
          sessions.map((session, idx) => (
            <Box key={session.id}>
              <Text color={idx === selectedIdx ? 'cyan' : undefined}>
                {idx === selectedIdx ? '> ' : '  '}
                {session.title ?? 'Untitled session'}
              </Text>
              <Text color="gray">
                {'  '}({session.messageCount} msgs, {formatDate(session.updatedAt)})
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray">
          j/k=move Enter=open n=new d=delete | t=tools s=secrets c=schedules p=prompt q=quit
        </Text>
      </Box>
    </Box>
  );
}
