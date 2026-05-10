// pattern: UI Shell — read-only scrollable system prompt viewer

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { theme } from '../theme.ts';
import ScreenLayout from '../ScreenLayout.tsx';

type SystemPromptScreenProps = {
  readonly getSystemPrompt: () => Promise<string>;
  readonly onBack: () => void;
};

export default function SystemPromptScreen(props: SystemPromptScreenProps): React.ReactElement {
  const { getSystemPrompt, onBack } = props;

  const [prompt, setPrompt] = useState<string>('Loading...');
  const [scrollOffset, setScrollOffset] = useState(0);

  const { rows } = useWindowSize();
  const headerRows = 1;
  const statusBarRows = 3;
  const visibleHeight = Math.max(5, rows - headerRows - statusBarRows);

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

  const headerContent = (
    <Box paddingX={1}>
      <Text bold color={theme.heading}>
        System Prompt
      </Text>
    </Box>
  );

  return (
    <ScreenLayout
      header={headerContent}
      headerHeight={headerRows}
      statusKeys={[
        { key: 'j/k', label: 'scroll' },
        { key: 'PgUp/Dn', label: 'page' },
        { key: 'g/G', label: 'top/bottom' },
        { key: 'Esc', label: 'back' },
      ]}
      statusText={`Lines ${scrollOffset + 1}–${lineEnd} of ${totalLines}`}
    >
      {visible.map((line, i) => (
        <Text key={`${scrollOffset}-${i}`} color={theme.muted}>
          {line || ' '}
        </Text>
      ))}
    </ScreenLayout>
  );
}
