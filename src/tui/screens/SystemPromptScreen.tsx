// pattern: UI Shell — read-only scrollable system prompt viewer

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

type SystemPromptScreenProps = {
  readonly getSystemPrompt: () => Promise<string>;
  readonly onBack: () => void;
};

export default function SystemPromptScreen(props: SystemPromptScreenProps): React.ReactElement {
  const { getSystemPrompt, onBack } = props;

  const [prompt, setPrompt] = useState<string>('Loading...');
  const [scrollOffset, setScrollOffset] = useState(0);

  const { stdout } = useStdout();
  const visibleHeight = Math.max(5, (stdout?.rows ?? 24) - 6);

  useEffect(() => {
    let cancelled = false;
    getSystemPrompt()
      .then((text) => {
        if (!cancelled) setPrompt(text);
      })
      .catch((err) => {
        if (!cancelled) {
          setPrompt(`Error loading system prompt: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getSystemPrompt]);

  const lines = prompt.split('\n');
  const totalLines = lines.length;
  const maxOffset = Math.max(0, totalLines - visibleHeight);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setScrollOffset((o) => Math.min(o + 1, maxOffset));
    } else if (input === 'k' || key.upArrow) {
      setScrollOffset((o) => Math.max(o - 1, 0));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(o + visibleHeight, maxOffset));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(o - visibleHeight, 0));
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(maxOffset);
    }
  });

  const visible = lines.slice(scrollOffset, scrollOffset + visibleHeight);
  const lineEnd = Math.min(scrollOffset + visibleHeight, totalLines);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        System Prompt
      </Text>
      <Box>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box flexDirection="column">
        {visible.map((line, i) => (
          <Text key={`${scrollOffset}-${i}`} dimColor>
            {line || ' '}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text color="gray">
          Lines {scrollOffset + 1}-{lineEnd} of {totalLines} | j/k=scroll PgUp/PgDn g/G=top/bottom Esc=back
        </Text>
      </Box>
    </Box>
  );
}
