// Barrel export + render entry point for the TUI module

import React from 'react';
import { render } from 'ink';
import App from './App.tsx';
import type { TuiDependencies } from './types.ts';

export type { TuiDependencies };
export { App };

/**
 * Render the full-screen TUI application.
 * Call this from the imperative shell (src/index.ts).
 */
export function startTUI(props: TuiDependencies): void {
  render(React.createElement(App, props));
}
