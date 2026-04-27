// pattern: UI Shell — navigation shell for the multi-screen TUI

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SessionsScreen from './screens/SessionsScreen.tsx';
import ChatScreen from './screens/ChatScreen.tsx';
import ToolsScreen from './screens/ToolsScreen.tsx';
import SecretsScreen from './screens/SecretsScreen.tsx';
import SchedulesScreen from './screens/SchedulesScreen.tsx';
import SystemPromptScreen from './screens/SystemPromptScreen.tsx';
import { buildSystemPrompt, loadCoreMemoryFromStore } from '../agent/context.ts';
import type { Screen, TuiDependencies } from './types.ts';

export type AppProps = TuiDependencies;

export default function App(deps: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1]!;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [subModeActive, setSubModeActive] = useState(false);

  const push = useCallback((screen: Screen) => {
    setScreenStack((prev) => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const getSystemPrompt = useCallback(async (): Promise<string> => {
    let prompt: string;
    if (deps.systemPromptProvider) {
      prompt = await deps.systemPromptProvider(deps.toolDocs ?? '');
    } else if (!deps.personaPath || !deps.timezone) {
      return 'System prompt unavailable: personaPath/timezone not provided.';
    } else {
      const persona = await Bun.file(deps.personaPath).text();
      const coreMemory = loadCoreMemoryFromStore(deps.store);
      const allDocs = deps.store.docList(500);
      const skillNames = allDocs.documents
        .filter((d) => d.rkey.startsWith('skill:'))
        .map((d) => d.rkey);
      prompt = buildSystemPrompt(persona, coreMemory, skillNames, deps.toolDocs ?? '', deps.timezone);
    }

    if (deps.customTools) {
      const summaries = deps.customTools.getApprovedToolSummaries();
      if (summaries.length > 0) {
        const listing = summaries
          .map((s) => `- **${s.name}** — ${s.description}`)
          .join('\n');
        prompt += `\n\n## Custom Tools (call via tools.call_custom_tool)\n\n${listing}`;
      }
    }

    return prompt;
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
            <Text color="yellow">Secret management not available.</Text>
            <Text dimColor>Press Escape to go back.</Text>
          </Box>
        );
      }
      return <SecretsScreen secrets={deps.secrets} store={deps.store} onBack={pop} />;
    case 'schedules':
      if (!deps.scheduler) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text color="yellow">Scheduler not available.</Text>
            <Text dimColor>Press Escape to go back.</Text>
          </Box>
        );
      }
      return <SchedulesScreen scheduler={deps.scheduler} onBack={pop} />;
    case 'prompt':
      return <SystemPromptScreen getSystemPrompt={getSystemPrompt} onBack={pop} />;
  }
}
