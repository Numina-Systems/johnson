// pattern: UI Shell — chat interface with event-driven status

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { Agent } from '../../agent/types.ts';
import type { Store } from '../../store/store.ts';
import { onLog } from '../../util/log.ts';
import { formatStats } from '../../agent/format-stats.ts';

type DisplayMessage = {
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
};

type ChatScreenProps = {
  readonly agent: Agent;
  readonly store: Store;
  readonly sessionId: string;
  readonly onBack: () => void;
};

export default function ChatScreen(props: ChatScreenProps): React.ReactElement {
  const { agent, store, sessionId, onBack } = props;
  const { exit } = useApp();

  const [messages, setMessages] = useState<readonly DisplayMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [inputValue, setInputValue] = useState('');

  // Load existing messages from the store on mount
  useEffect(() => {
    const stored = store.getMessages(sessionId, 200);
    const loaded: DisplayMessage[] = stored.map((m) => ({
      role: (m.role === 'assistant' ? 'agent' : (m.role as 'user' | 'system')),
      text: m.content,
    }));
    setMessages(loaded);
  }, [sessionId, store]);

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
            text: 'Commands: /reset /help /quit | Esc=back to Sessions (for screen navigation: tools, secrets, schedules, prompt)',
          },
        ]);
        return;
      }

      setMessages((prev) => [...prev, { role: 'user', text: input }]);
      store.appendMessage(sessionId, 'user', input);
      setIsThinking(true);
      setStatus('Thinking...');

      try {
        const result = await agent.chat(input, {
          sessionId,
          onEvent: async (event) => {
            switch (event.kind) {
              case 'llm_start':
                setStatus('Thinking...');
                break;
              case 'llm_done': {
                const round = event.data['round'];
                setStatus(typeof round === 'number' ? `Round ${round} complete` : 'Round complete');
                break;
              }
              case 'tool_start':
                setStatus('Running code...');
                break;
              case 'tool_done': {
                const success = event.data['success'];
                setStatus(success === false ? 'Code error' : 'Code finished');
                break;
              }
            }
          },
        });
        setMessages((prev) => [...prev, { role: 'agent', text: result.text }]);
        store.appendMessage(sessionId, 'assistant', result.text);
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
    [agent, isThinking, exit, store, sessionId],
  );

  // Ctrl+C and Escape handling
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      process.exit(0);
    }
    if (key.escape && !isThinking) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
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
          [{status}] /reset /help /quit | Esc=back
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
}
