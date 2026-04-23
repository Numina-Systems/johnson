// pattern: Functional Core — centralized log buffer for TUI-safe logging
//
// When the TUI is active, direct process.stderr.write corrupts Ink's rendering.
// This module buffers log lines so the TUI can render them, and falls back to
// stderr when no TUI is active.

type LogListener = (line: string) => void;

let listener: LogListener | null = null;
const buffer: Array<string> = [];
const MAX_BUFFER = 100;

/**
 * Register a listener (the TUI) to receive log lines.
 * Flushes any buffered lines immediately.
 */
export function onLog(fn: LogListener): () => void {
  listener = fn;
  // Flush buffer
  for (const line of buffer) {
    fn(line);
  }
  buffer.length = 0;
  return () => { listener = null; };
}

/**
 * Log a line. Routes to TUI listener if registered, otherwise stderr.
 */
export function log(message: string): void {
  const line = message.endsWith('\n') ? message.slice(0, -1) : message;

  if (listener) {
    listener(line);
  } else {
    // Buffer for when TUI connects, and also write to stderr
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    process.stderr.write(line + '\n');
  }
}
