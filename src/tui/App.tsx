// pattern: UI Shell — navigation shell for the multi-screen TUI

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { onLog } from '../util/log.ts';
import SessionsScreen from './screens/SessionsScreen.tsx';
import ChatScreen from './screens/ChatScreen.tsx';
import ToolsScreen from './screens/ToolsScreen.tsx';
import SecretsScreen from './screens/SecretsScreen.tsx';
import SchedulesScreen from './screens/SchedulesScreen.tsx';
import SystemPromptScreen from './screens/SystemPromptScreen.tsx';
import PruneScreen from './screens/PruneScreen.tsx';
import { buildSystemPrompt } from '../agent/prompt.ts';
import { theme } from './theme.ts';
import type { Screen, TuiDependencies } from './types.ts';

export type AppProps = TuiDependencies;

export default function App(deps: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1]!;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [subModeActive, setSubModeActive] = useState(false);
  const [logLines, setLogLines] = useState<readonly string[]>([]);

  useEffect(() => {
    return onLog((line) => {
      setLogLines((prev) => {
        const next = [...prev, line];
        return next.length > 200 ? next.slice(-200) : next;
      });
    });
  }, []);

  const push = useCallback((screen: Screen) => {
    setScreenStack((prev) => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const getSystemPrompt = useCallback(async (): Promise<string> => {
    if (!deps.timezone) {
      return 'System prompt unavailable: timezone not provided.';
    }

    const selfDoc = deps.store.docGet('self')?.content?.trim() ?? '';
    const allDocs = deps.store.docList(500);
    const skillNames = allDocs.documents
      .filter((d) => d.rkey.startsWith('skill:'))
      .map((d) => d.rkey);

    const customToolSummaries = deps.customTools
      ? deps.customTools.getApprovedToolSummaries()
      : undefined;

    const secretNames = deps.secrets
      ? deps.secrets.listKeys()
      : undefined;

    return buildSystemPrompt({
      selfDoc,
      skillNames,
      toolDocs: deps.toolDocs ?? '',
      timezone: deps.timezone,
      customToolSummaries,
      secretNames,
      nativeToolNames: deps.builtinTools?.map(t => t.name),
    });
  }, [deps]);

  // Ctrl+C fallback (always active)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      process.exit(0);
    }
  });

  // Global navigation — disabled on the chat screen (ChatScreen owns its own input)
  // and disabled when a sub-screen is in a sub-mode that owns its own keybindings
  // (e.g. ToolsScreen viewing skill code, where 'q' should mean "back to list").
  const globalNavActive = currentScreen !== 'chat' && !subModeActive;
  useInput(
    (input, key) => {
      if (input === 't') push('tools');
      if (input === 's') push('secrets');
      if (input === 'c') push('schedules');
      if (input === 'p') push('prompt');
      if (input === 'r') push('prune');
      if (input === 'q') {
        exit();
        process.exit(0);
      }
      if (key.escape) pop();
    },
    { isActive: globalNavActive },
  );

  switch (currentScreen) {
    case 'sessions':
      return (
        <SessionsScreen
          store={deps.store}
          modelName={deps.modelName}
          secrets={deps.secrets}
          scheduler={deps.scheduler}
          customTools={deps.customTools}
          onSelectSession={(sessionId) => {
            setActiveSessionId(sessionId);
            push('chat');
          }}
          onNewSession={() => {
            const id = crypto.randomUUID();
            deps.store.createSession(id);
            setActiveSessionId(id);
            push('chat');
          }}
        />
      );
    case 'chat':
      if (!activeSessionId) {
        pop();
        return <Text>No session selected</Text>;
      }
      return (
        <ChatScreen
          agent={deps.agent}
          store={deps.store}
          sessionId={activeSessionId}
          onBack={pop}
        />
      );
    case 'tools':
      return (
        <ToolsScreen
          store={deps.store}
          secrets={deps.secrets}
          customTools={deps.customTools}
          builtinTools={deps.builtinTools ?? []}
          onBack={pop}
          onSubModeChange={setSubModeActive}
        />
      );
    case 'secrets':
      if (!deps.secrets) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text color={theme.warning}>Secret management not available.</Text>
            <Text color={theme.dim}>Press Escape to go back.</Text>
          </Box>
        );
      }
      return <SecretsScreen secrets={deps.secrets} store={deps.store} customTools={deps.customTools ?? undefined} onBack={pop} />;
    case 'schedules':
      if (!deps.scheduler) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text color={theme.warning}>Scheduler not available.</Text>
            <Text color={theme.dim}>Press Escape to go back.</Text>
          </Box>
        );
      }
      return <SchedulesScreen scheduler={deps.scheduler} onBack={pop} />;
    case 'prompt':
      return <SystemPromptScreen getSystemPrompt={getSystemPrompt} onBack={pop} />;
    case 'prune':
      return (
        <PruneScreen
          store={deps.store}
          onBack={pop}
          onSubModeChange={setSubModeActive}
        />
      );
  }
}
