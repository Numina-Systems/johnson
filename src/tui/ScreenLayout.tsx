// pattern: Functional Core — layout shell that pins header/footer and constrains the body

import React from 'react';
import { Box, useWindowSize } from 'ink';
import StatusBar from './StatusBar.tsx';
import type { KeyChip } from './theme.ts';

type ScreenLayoutProps = {
  readonly header: React.ReactNode;
  readonly headerHeight: number;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly footerHeight?: number;
  readonly statusKeys: ReadonlyArray<KeyChip>;
  readonly statusText?: string;
  readonly statusWidth?: number;
};

export default function ScreenLayout(props: ScreenLayoutProps): React.ReactElement {
  const {
    header, headerHeight,
    children,
    footer, footerHeight = 0,
    statusKeys, statusText, statusWidth,
  } = props;
  const { rows } = useWindowSize();

  const statusBarHeight = statusText ? 3 : 2;
  const bodyHeight = Math.max(3, rows - headerHeight - statusBarHeight - footerHeight);

  return (
    <Box flexDirection="column" height={rows}>
      {header}

      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        {children}
      </Box>

      {footer}

      <StatusBar keys={statusKeys} status={statusText} width={statusWidth} />
    </Box>
  );
}
