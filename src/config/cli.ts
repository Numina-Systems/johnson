// pattern: Functional Core

import { VALID_INTERFACE_MODES, type InterfaceMode } from './types.ts';

/**
 * Parse --interface flag from argv array.
 * Returns the interface mode if found and valid, otherwise null.
 */
export function parseCliArgs(argv: ReadonlyArray<string>): InterfaceMode | null {
  const idx = argv.indexOf('--interface');
  if (idx === -1 || idx + 1 >= argv.length) {
    return null;
  }

  const value = argv[idx + 1];
  if (VALID_INTERFACE_MODES.includes(value as InterfaceMode)) {
    return value as InterfaceMode;
  }

  return null;
}
