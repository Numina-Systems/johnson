// pattern: Functional Core — reusable styled status bar component

import React from 'react';
import { Box, Text } from 'ink';
import { theme, separator, formatKeyChips } from './theme.ts';
import type { KeyChip } from './theme.ts';

type StatusBarProps = {
  readonly keys: ReadonlyArray<KeyChip>;
  readonly status?: string;
  readonly width?: number;
};

export default function StatusBar(props: StatusBarProps): React.ReactElement {
  const { keys, status, width = 60 } = props;
  const chips = formatKeyChips(keys);

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={theme.separator}>{separator(width - 2)}</Text>
      </Box>
      {status && (
        <Box paddingX={1}>
          <Text color={theme.muted}>{status}</Text>
        </Box>
      )}
      <Box paddingX={1}>
        {chips.map((chip) => (
          <React.Fragment key={chip.key}>
            <Text color={theme.statusKey} bold>{chip.key}</Text>
            <Text color={theme.statusLabel}> {chip.label}</Text>
            {chip.sep && <Text color={theme.statusSep}>{chip.sep}</Text>}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
