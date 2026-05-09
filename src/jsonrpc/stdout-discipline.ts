// pattern: Imperative Shell

export function enforceStdoutDiscipline(): void {
  const stderrWrite = process.stderr.write.bind(process.stderr);

  console.log = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.info = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.warn = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  console.debug = (...args: ReadonlyArray<unknown>) => {
    stderrWrite(args.map(String).join(' ') + '\n');
  };

  // Note: console.error is intentionally not overridden — Node.js/Bun already write
  // console.error to stderr natively, so no redirection is needed.
}
