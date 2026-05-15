// pattern: UI Shell — chat interface with event-driven status

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { Agent } from '../../agent/types.ts';
import type { Store } from '../../store/store.ts';
import { formatStats } from '../../agent/format-stats.ts';
import { theme, separator } from '../theme.ts';
import ScreenLayout from '../ScreenLayout.tsx';
import { highlightMarkdown } from '../syntax.ts';

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
  const [scrollOffset, setScrollOffset] = useState(0);
  const pinnedToBottom = useRef(true);
  const { rows } = useWindowSize();
  const APPROX_VISIBLE_MSGS = Math.max(3, Math.floor((rows - 6) / 3));

  useEffect(() => {
    const stored = store.getMessages(sessionId, 200);
    const loaded: DisplayMessage[] = stored.map((m) => ({
      role: (m.role === 'assistant' ? 'agent' : (m.role as 'user' | 'system')),
      text: m.content,
    }));
    setMessages(loaded);
    setScrollOffset(Math.max(0, loaded.length - APPROX_VISIBLE_MSGS));
    pinnedToBottom.current = true;
  }, [sessionId, store, APPROX_VISIBLE_MSGS]);

  useEffect(() => {
    if (pinnedToBottom.current) {
      setScrollOffset(Math.max(0, messages.length - APPROX_VISIBLE_MSGS));
    }
  }, [messages.length, APPROX_VISIBLE_MSGS]);


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
            text: 'Commands: /reset /help /quit | Esc=back to Sessions',
          },
        ]);
        return;
      }

      pinnedToBottom.current = true;
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

  const maxOffset = Math.max(0, messages.length - APPROX_VISIBLE_MSGS);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      process.exit(0);
    }
    if (key.escape && !isThinking) {
      onBack();
      return;
    }

    if (key.shift && key.upArrow) {
      setScrollOffset((o) => {
        const next = Math.max(o - 1, 0);
        pinnedToBottom.current = next >= maxOffset;
        return next;
      });
    } else if (key.shift && key.downArrow) {
      setScrollOffset((o) => {
        const next = Math.min(o + 1, maxOffset);
        pinnedToBottom.current = next >= maxOffset;
        return next;
      });
    } else if (key.pageUp) {
      setScrollOffset((o) => {
        const next = Math.max(o - APPROX_VISIBLE_MSGS, 0);
        pinnedToBottom.current = next >= maxOffset;
        return next;
      });
    } else if (key.pageDown) {
      setScrollOffset((o) => {
        const next = Math.min(o + APPROX_VISIBLE_MSGS, maxOffset);
        pinnedToBottom.current = next >= maxOffset;
        return next;
      });
    }
  });

  const headerContent = (
    <Box paddingX={1}>
      <Text color={theme.separator}>{separator(60)}</Text>
    </Box>
  );

  const footerContent = (
    <Box paddingX={1}>
      <Text color={theme.prompt} bold>
        {'▸ '}
      </Text>
      <TextInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        placeholder={isThinking ? 'waiting...' : 'Type a message...'}
      />
    </Box>
  );

  return (
    <ScreenLayout
      header={headerContent}
      headerHeight={1}
      footer={footerContent}
      footerHeight={1}
      statusKeys={[
        { key: 'S-↑↓', label: 'scroll' },
        { key: 'PgUp/Dn', label: 'page' },
        { key: 'Esc', label: 'back' },
      ]}
      statusText={status}
    >
      {scrollOffset > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>
            ↑ {scrollOffset} message{scrollOffset !== 1 ? 's' : ''} above — Shift+↑ to scroll
          </Text>
        </Box>
      )}
      {messages.slice(scrollOffset).map((msg, i) => (
        <Box key={scrollOffset + i} marginBottom={0}>
          {msg.role === 'user' && (
            <Text wrap="wrap">
              <Text color={theme.userMsg} bold>
                you&gt;{' '}
              </Text>
              <Text color={theme.body}>{msg.text}</Text>
            </Text>
          )}
          {msg.role === 'agent' && (
            <Text wrap="wrap">
              <Text color={theme.agentMsg} bold>
                agent&gt;{' '}
              </Text>
              <Text>{highlightMarkdown(msg.text)}</Text>
            </Text>
          )}
          {msg.role === 'system' && (
            <Text wrap="wrap" color={theme.systemMsg}>
              {msg.text}
            </Text>
          )}
        </Box>
      ))}

      {isThinking && (
        <Box>
          <Text color={theme.spinner}>
            <Spinner type="dots" />{' '}
          </Text>
          <Text color={theme.spinner}>{status}</Text>
        </Box>
      )}
    </ScreenLayout>
  );
}
