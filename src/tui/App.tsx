// pattern: UI Shell — navigation shell for the multi-screen TUI

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SessionsScreen from './screens/SessionsScreen.tsx';
import ChatScreen from './screens/ChatScreen.tsx';
import ToolsScreen from './screens/ToolsScreen.tsx';
import SecretsScreen from './screens/SecretsScreen.tsx';
import type { Screen, TuiDependencies } from './types.ts';

export type AppProps = TuiDependencies;

export default function App(deps: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1]!;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const push = useCallback((screen: Screen) => {
    setScreenStack((prev) => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Ctrl+C fallback (always active)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      process.exit(0);
    }
  });

  // Global navigation — disabled on the chat screen (ChatScreen owns its own input)
  const globalNavActive = currentScreen !== 'chat';
  useInput(
    (input, key) => {
      if (input === 't') push('tools');
      if (input === 's') push('secrets');
      if (input === 'c') push('schedules');
      if (input === 'p') push('prompt');
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
        />
      );
    case 'secrets':
      if (!deps.secrets) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text color="yellow">Secret management not available.</Text>
            <Text dimColor>Press Escape to go back.</Text>
          </Box>
        );
      }
      return <SecretsScreen secrets={deps.secrets} store={deps.store} onBack={pop} />;
    case 'schedules':
      return <Text>Schedules screen (Phase 6) — press Escape to go back</Text>;
    case 'prompt':
      return <Text>System Prompt screen (Phase 7) — press Escape to go back</Text>;
  }
}
