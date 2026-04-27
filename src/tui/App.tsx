// pattern: UI Shell — full-screen terminal interface using Ink

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { onLog } from '../util/log.ts';
import { formatStats } from '../agent/format-stats.ts';
import SessionsScreen from './screens/SessionsScreen.tsx';
import type { Screen, TuiDependencies } from './types.ts';

// ── Types ──────────────────────────────────────────────────────────────────

type Message = {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
};

export type AppProps = TuiDependencies;

// ── Component ──────────────────────────────────────────────────────────────

export default function App(deps: AppProps): React.ReactElement {
  const { agent, modelName } = deps;
  const { exit } = useApp();

  const [screenStack, setScreenStack] = useState<Screen[]>(['sessions']);
  const currentScreen = screenStack[screenStack.length - 1]!;

  // Chat state (kept here until Phase 3 extracts ChatScreen)
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [inputValue, setInputValue] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const push = useCallback((screen: Screen) => {
    setScreenStack(prev => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Subscribe to background logs (scheduler, discord, etc.)
  useEffect(() => {
    const unsubscribe = onLog((line) => {
      setMessages((prev) => [...prev, { role: 'system', text: line }]);
    });
    return unsubscribe;
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const input = value.trim();
      if (!input || isThinking) return;

      setInputValue('');

      if (input === '/quit' || input === '/exit') {
        exit();
        process.exit(0);
      }

      if (input === '/reset') {
        agent.reset();
        setMessages((prev) => [
          ...prev,
          { role: 'system', text: '[conversation reset]' },
        ]);
        setStatus('Ready');
        return;
      }

      if (input === '/help') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            text: 'Commands: /reset /help /quit | Navigation: t=tools s=secrets c=schedules p=prompt Esc=back',
          },
        ]);
        return;
      }

      setMessages((prev) => [...prev, { role: 'user', text: input }]);
      setIsThinking(true);
      setStatus('Thinking...');

      try {
        const result = await agent.chat(input);
        setMessages((prev) => [...prev, { role: 'agent', text: result.text }]);
        setStatus(formatStats(result.stats));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { role: 'system', text: `[error] ${errMsg}` },
        ]);
        setStatus('Error — see above');
      } finally {
        setIsThinking(false);
      }
    },
    [agent, isThinking, exit],
  );

  // Ctrl+C fallback (always active)
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
      process.exit(0);
    }
  });

  // Global navigation — inactive when chat input is focused (i.e., user is typing)
  // Active when on any non-chat screen, or when on chat screen during thinking
  const globalNavActive = currentScreen !== 'chat' || isThinking;
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
          </Box>
          <Box paddingX={1}>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>

          <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
            {messages.map((msg, i) => (
              <Box key={i} marginBottom={0}>
                {msg.role === 'user' && (
                  <Text wrap="wrap">
                    <Text color="cyan" bold>
                      you&gt;{' '}
                    </Text>
                    <Text>{msg.text}</Text>
                  </Text>
                )}
                {msg.role === 'agent' && (
                  <Text wrap="wrap">
                    <Text color="green" bold>
                      agent&gt;{' '}
                    </Text>
                    <Text>{msg.text}</Text>
                  </Text>
                )}
                {msg.role === 'system' && (
                  <Text wrap="wrap" color="yellow">
                    {msg.text}
                  </Text>
                )}
              </Box>
            ))}

            {isThinking && (
              <Box>
                <Text color="magenta">
                  <Spinner type="dots" />{' '}
                </Text>
                <Text color="magenta">{status}</Text>
              </Box>
            )}
          </Box>

          <Box paddingX={1}>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>
          <Box paddingX={1}>
            <Text color="gray">
              [{status}] /reset /help /quit | t=tools s=secrets c=schedules p=prompt
            </Text>
          </Box>

          <Box paddingX={1}>
            <Text color="cyan" bold>
              {'> '}
            </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder={isThinking ? 'waiting...' : 'Type a message...'}
            />
          </Box>
        </Box>
      );
    case 'tools':
      return <Text>Tools screen (Phase 4) — press Escape to go back</Text>;
    case 'secrets':
      return <Text>Secrets screen (Phase 5) — press Escape to go back</Text>;
    case 'schedules':
      return <Text>Schedules screen (Phase 6) — press Escape to go back</Text>;
    case 'prompt':
      return <Text>System Prompt screen (Phase 7) — press Escape to go back</Text>;
  }
}
