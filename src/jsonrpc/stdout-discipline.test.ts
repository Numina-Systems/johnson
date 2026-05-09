// pattern: Imperative Shell (test)

import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { enforceStdoutDiscipline } from './stdout-discipline.ts';

describe('enforceStdoutDiscipline', () => {
  let capturedOutput: string[] = [];

  beforeEach(() => {
    capturedOutput = [];
  });

  it('I3.AC1.1: console.log output goes to stderr after enforceStdoutDiscipline()', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.log('test message');

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('test message\n');

    process.stderr.write = originalStderrWrite;
  });

  it('I3.AC1.2: console.info output goes to stderr after enforceStdoutDiscipline()', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.info('info message');

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('info message\n');

    process.stderr.write = originalStderrWrite;
  });

  it('I3.AC1.3: console.warn output goes to stderr after enforceStdoutDiscipline()', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.warn('warn message');

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('warn message\n');

    process.stderr.write = originalStderrWrite;
  });

  it('I3.AC1.4: console.debug output goes to stderr after enforceStdoutDiscipline()', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.debug('debug message');

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('debug message\n');

    process.stderr.write = originalStderrWrite;
  });

  it('I3.AC1.5: multiple arguments are joined with spaces', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.log('arg1', 'arg2', 'arg3');

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('arg1 arg2 arg3\n');

    process.stderr.write = originalStderrWrite;
  });

  it('I3.AC1.6: non-string arguments are converted to strings', () => {
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = mock((data: string) => {
      capturedOutput.push(data);
      return true as any;
    });

    enforceStdoutDiscipline();
    console.log('count:', 42, 'flag:', true);

    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput[capturedOutput.length - 1]).toBe('count: 42 flag: true\n');

    process.stderr.write = originalStderrWrite;
  });
});
