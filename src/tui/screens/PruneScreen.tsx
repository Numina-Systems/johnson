// pattern: UI Shell — multi-select session prune screen

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Store } from '../../store/store.ts';
import type { SessionWithCounts, SessionClassification, PruneResult } from '../../sessions/types.ts';
import { classifySession } from '../../sessions/archive.ts';
import { archiveSession } from '../../sessions/archiver.ts';
import { formatDate } from '../util.ts';
import { theme } from '../theme.ts';
import ScreenLayout from '../ScreenLayout.tsx';

type PruneScreenProps = {
  readonly store: Store;
  readonly onBack: () => void;
  readonly onSubModeChange?: (active: boolean) => void;
};

type EnrichedSession = SessionWithCounts & {
  readonly classification: SessionClassification;
};

type Mode = 'select' | 'confirm' | 'executing';

export default function PruneScreen(props: PruneScreenProps): React.ReactElement {
  const { store, onBack, onSubModeChange } = props;

  const [sessions, setSessions] = useState<ReadonlyArray<EnrichedSession>>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('select');
  const [result, setResult] = useState<PruneResult | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Load sessions from store
  const loadSessions = useCallback(() => {
    const rows = store.listSessionsWithCounts();
    const enriched: Array<EnrichedSession> = rows.map((s) => ({
      ...s,
      classification: classifySession(s.messageCount, s.updatedAt, new Date()),
    }));
    setSessions(enriched);
    setSelectedIdx((idx) => Math.min(idx, Math.max(0, enriched.length - 1)));
  }, [store]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Notify parent of sub-mode changes
  useEffect(() => {
    onSubModeChange?.(mode !== 'select');
    return () => onSubModeChange?.(false);
  }, [mode, onSubModeChange]);

  const toggleSelection = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllStale = useCallback(() => {
    const staleIds = sessions
      .filter((s) => s.classification === 'delete' || s.classification === 'archive')
      .map((s) => s.id);
    setSelected(new Set(staleIds));
  }, [sessions]);

  const handleExecute = useCallback(async () => {
    setStatusMsg('');
    setMode('executing');
    const details: Array<{
      id: string;
      title: string | null;
      action: 'deleted' | 'archived';
      rkey?: string;
    }> = [];

    let deleted = 0;
    let archived = 0;
    let errors = 0;

    for (const sessionId of selected) {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) continue;

      try {
        if (session.messageCount === 0) {
          // Delete empty sessions
          store.deleteSession(sessionId);
          deleted++;
          details.push({
            id: sessionId,
            title: session.title,
            action: 'deleted',
          });
        } else {
          // Archive sessions with messages
          const archiveResult = await archiveSession(sessionId, store);
          archived++;
          details.push({
            id: sessionId,
            title: session.title,
            action: 'archived',
            rkey: archiveResult.rkey,
          });
        }
      } catch (error) {
        errors++;
        setStatusMsg(`Error processing ${session.title || 'session'}: ${String(error)}`);
      }
    }

    const pruneResult: PruneResult = {
      deleted,
      archived,
      details,
      errors,
    };

    setResult(pruneResult);
    setSelected(new Set());
    loadSessions();
    setMode('select');
  }, [selected, sessions, store, loadSessions]);

  const handleConfirm = useCallback(() => {
    setStatusMsg('');
    const toArchive = sessions.filter((s) => selected.has(s.id) && s.messageCount > 0).length;
    const toDelete = sessions.filter((s) => selected.has(s.id) && s.messageCount === 0).length;

    if (toArchive === 0 && toDelete === 0) {
      setStatusMsg('No sessions selected');
      return;
    }

    setMode('confirm');
  }, [selected, sessions]);

  // Keyboard input
  useInput((input, key) => {
    if (mode === 'confirm') {
      if (input === 'y' || key.return) {
        handleExecute();
        return;
      }
      if (input === 'n' || key.escape) {
        setMode('select');
        return;
      }
      return;
    }

    if (mode === 'executing') {
      // Locked during execution, no input
      return;
    }

    // select mode
    if (input === 'j' || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, sessions.length - 1)));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (input === ' ') {
      const session = sessions[selectedIdx];
      if (session) toggleSelection(session.id);
      return;
    }
    if (input === 'a') {
      selectAllStale();
      return;
    }
    if (key.return) {
      handleConfirm();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
  });

  if (sessions.length === 0) {
    const emptyHeader = (
      <Box paddingX={1}>
        <Text bold color={theme.heading}>
          Prune Sessions
        </Text>
      </Box>
    );
    return (
      <ScreenLayout
        header={emptyHeader}
        headerHeight={1}
        statusKeys={[
          { key: 'esc', label: 'back' },
        ]}
      >
        <Text color={theme.dim}>No sessions to prune.</Text>
      </ScreenLayout>
    );
  }

  const toArchive = sessions.filter((s) => selected.has(s.id) && s.messageCount > 0).length;
  const toDelete = sessions.filter((s) => selected.has(s.id) && s.messageCount === 0).length;

  if (mode === 'confirm') {
    const confirmHeader = (
      <Box paddingX={1}>
        <Text bold color={theme.heading}>
          Prune Sessions — Confirm
        </Text>
      </Box>
    );
    return (
      <ScreenLayout
        header={confirmHeader}
        headerHeight={1}
        statusKeys={[
          { key: 'y', label: 'confirm' },
          { key: 'n', label: 'cancel' },
        ]}
        statusText={`Archive ${toArchive} session${toArchive !== 1 ? 's' : ''}, delete ${toDelete} session${toDelete !== 1 ? 's' : ''}. Proceed? (y/n)`}
      >
        <Box />
      </ScreenLayout>
    );
  }

  if (mode === 'executing') {
    const executingHeader = (
      <Box paddingX={1}>
        <Text bold color={theme.heading}>
          Prune Sessions — Executing
        </Text>
      </Box>
    );
    return (
      <ScreenLayout
        header={executingHeader}
        headerHeight={1}
        statusKeys={[]}
      >
        <Text color={theme.accent}>Processing {selected.size} session(s)…</Text>
      </ScreenLayout>
    );
  }

  // select mode
  const selectHeader = (
    <Box paddingX={1}>
      <Text bold color={theme.heading}>
        Prune Sessions
      </Text>
    </Box>
  );

  const resultFooter = result ? (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text color={theme.success}>
        ✓ Archived {result.archived}, deleted {result.deleted}
        {result.errors ? `, ${result.errors} error${result.errors !== 1 ? 's' : ''}` : ''}
      </Text>
    </Box>
  ) : undefined;

  return (
    <ScreenLayout
      header={selectHeader}
      headerHeight={1}
      statusKeys={[
        { key: 'j/k', label: 'move' },
        { key: '␣', label: 'toggle' },
        { key: 'a', label: 'select stale' },
        { key: '⏎', label: 'execute' },
        { key: 'esc', label: 'back' },
      ]}
      footer={resultFooter}
      footerHeight={resultFooter ? 2 : 0}
      statusText={statusMsg || undefined}
    >
      <Box flexDirection="column" paddingX={1}>
        {sessions.map((session, idx) => {
          const isSelected = selected.has(session.id);
          const isCursor = idx === selectedIdx;
          const checkbox = isSelected ? '[✓]' : '[ ]';
          const cursor = isCursor ? '▸ ' : '  ';

          const classColor =
            session.classification === 'delete'
              ? theme.error
              : session.classification === 'archive'
                ? theme.warning
                : theme.success;
          const classLabel =
            session.classification === 'delete'
              ? 'delete'
              : session.classification === 'archive'
                ? 'archive'
                : 'active';

          const rowColor = isCursor ? theme.selected : theme.body;

          return (
            <Box key={session.id}>
              <Text color={rowColor}>
                {cursor}
                {checkbox}
              </Text>
              <Text color={rowColor}> {session.title || 'Untitled session'}</Text>
              <Text color={theme.dim}> ({session.messageCount} msg{session.messageCount !== 1 ? 's' : ''})</Text>
              <Text color={theme.dim}> · {formatDate(session.updatedAt)}</Text>
              <Text color={classColor}> [{classLabel}]</Text>
            </Box>
          );
        })}
      </Box>
    </ScreenLayout>
  );
}
