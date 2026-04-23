// pattern: UI Shell — full-screen terminal interface using Ink

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import ReviewPage from './ReviewPage.tsx';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';
import { onLog } from '../util/log.ts';
import { formatStats } from '../agent/format-stats.ts';

// ── Types ──────────────────────────────────────────────────────────────────

type Message = {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
};

import type { ChatResult } from '../agent/types.ts';

export type AppProps = {
  readonly agent: { chat(msg: string): Promise<ChatResult>; reset(): void };
  readonly modelName: string;
  readonly store?: Store;
  readonly secrets?: SecretManager;
};

type Page = 'chat' | 'review';

// ── Component ──────────────────────────────────────────────────────────────

export default function App({ agent, modelName, store, secrets }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [inputValue, setInputValue] = useState('');
  const [page, setPage] = useState<Page>('chat');

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

      // Handle commands
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

      if (input === '/review') {
        if (!store || !secrets) {
          setMessages((prev) => [
            ...prev,
            { role: 'system', text: '[grant system not configured]' },
          ]);
          return;
        }
        setPage('review');
        return;
      }

      if (input === '/help') {
        setMessages((prev) => [
          ...prev,
          { role: 'system', text: 'Commands: /reset /review /help /quit' },
        ]);
        return;
      }

      // Add user message
      setMessages((prev) => [...prev, { role: 'user', text: input }]);
      setIsThinking(true);
      setStatus('Thinking...');

      try {
        const result = await agent.chat(input);
        setMessages((prev) => [...prev, { role: 'agent', text: result.text }]);
        setStatus(formatStats(result.stats));
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { role: 'system', text: `[error] ${errMsg}` },
        ]);
        setStatus('Error — see above');
      } finally {
        setIsThinking(false);
      }
    },
    [agent, isThinking, exit, store, secrets],
  );

  // Ctrl+C fallback
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
      process.exit(0);
    }
  });

  // ── Review Page ──
  if (page === 'review' && store && secrets) {
    return (
      <ReviewPage
        store={store}
        secrets={secrets}
        onExit={() => setPage('chat')}
      />
    );
  }

  // ── Chat Page ──
  return (
    <Box flexDirection="column" height="100%">
      {/* ── Header ───────────────────────────────────────────── */}
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

      {/* ── Chat area ────────────────────────────────────────── */}
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

      {/* ── Status bar ───────────────────────────────────────── */}
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray">
          [{status}] /review /reset /help /quit
        </Text>
      </Box>

      {/* ── Input area ───────────────────────────────────────── */}
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
}
