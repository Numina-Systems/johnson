// pattern: Imperative Shell

import { unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import type { RuntimeConfig } from '../config/types.ts';
import type { CodeRuntime, ExecutionResult, ToolCallHandler } from './types.ts';

const MAX_TOOL_CALLS = 25;

const DENO_DIR = join(dirname(fileURLToPath(import.meta.url)), 'deno');

// Per-execution temp files (entry module, tool stubs) live outside the
// source tree — crashed runs must not litter src/, and a read-only install
// must still be able to execute code. Module loading is not gated by
// --allow-read, so the sandbox needs no read grant on this directory.
const SCRATCH_DIR = join(tmpdir(), 'constellation-exec');

/**
 * Build a sanitized environment for sandbox execution.
 * Only passes safe baseline vars + any explicitly granted secrets.
 * Parent process API keys, tokens, etc. are NOT inherited.
 */
function buildSandboxEnv(grantedSecrets?: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};

  // Baseline: only PATH and HOME (Deno needs these to function)
  if (process.env['PATH']) safe['PATH'] = process.env['PATH'];
  if (process.env['HOME']) safe['HOME'] = process.env['HOME'];
  if (process.env['TZ']) safe['TZ'] = process.env['TZ'];

  // Add any explicitly granted secrets
  if (grantedSecrets) {
    Object.assign(safe, grantedSecrets);
  }

  return safe;
}

function buildPermissionFlags(
  config: Readonly<RuntimeConfig>,
  envKeys: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const flags: Array<string> = [];

  if (config.unrestricted) {
    // Broad but explicit. Deliberately NOT --allow-all: subprocesses
    // (--allow-run) and native code (--allow-ffi) are not subject to Deno
    // permission flags, so either one would let sandbox code bypass the
    // data-dir deny below (e.g. `cat data/secrets.json`).
    flags.push('--allow-net');
    flags.push('--allow-read');
    flags.push('--allow-write');
    flags.push('--allow-env');
    flags.push('--allow-sys');
    flags.push('--no-prompt');
  } else {
    if (config.allowedHosts.length > 0) {
      flags.push(`--allow-net=${config.allowedHosts.join(',')}`);
    }

    const readPaths = [config.workingDir, DENO_DIR];
    flags.push(`--allow-read=${readPaths.join(',')}`);
    flags.push(`--allow-write=${config.workingDir}`);
    // Granted secrets arrive as env vars — without an explicit env grant,
    // Deno.env.get() on them throws under --no-prompt.
    if (envKeys.length > 0) {
      flags.push(`--allow-env=${envKeys.join(',')}`);
    }
    flags.push('--no-prompt');
  }

  // Always deny access to data dir (grants, secrets) — even in unrestricted mode
  if (config.dataDir) {
    flags.push(`--deny-read=${config.dataDir}`);
    flags.push(`--deny-write=${config.dataDir}`);
  }

  return flags;
}

/**
 * Read stdout from a process line-by-line, yielding complete lines.
 * Buffers partial chunks until a newline is found.
 */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        yield buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
      }
    }

    // Flush any remaining data without a trailing newline
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createDenoExecutor(config: Readonly<RuntimeConfig>): CodeRuntime {
  return {
    async execute(
      code: string,
      env?: Record<string, string>,
      onToolCall?: ToolCallHandler,
      stubsCode?: string,
    ): Promise<ExecutionResult> {
      // Validate code size
      if (new TextEncoder().encode(code).byteLength > config.maxCodeSize) {
        return {
          success: false,
          output: '',
          error: `Code exceeds maximum size of ${config.maxCodeSize} bytes`,
          duration_ms: 0,
        };
      }

      const execId = randomUUID();
      const tempFile = join(SCRATCH_DIR, `_constellation_${execId}.ts`);
      const stubsFile = (onToolCall && stubsCode)
        ? join(SCRATCH_DIR, `_constellation_${execId}_tools.ts`)
        : null;

      const startTime = performance.now();
      let timedOut = false;
      try {
        await mkdir(SCRATCH_DIR, { recursive: true });

        // The scratch dir is outside DENO_DIR, so the runtime bridge must be
        // imported by absolute file URL rather than a sibling-relative path.
        const runtimeUrl = pathToFileURL(join(DENO_DIR, 'runtime.ts')).href;

        if (stubsFile && stubsCode) {
          await Bun.write(stubsFile, stubsCode.replace('"./runtime.ts"', JSON.stringify(runtimeUrl)));
        }

        const fileContents = onToolCall
          ? `import { output, debug } from ${JSON.stringify(runtimeUrl)};\nimport * as tools from "./_constellation_${execId}_tools.ts";\nexport { tools };\n\n${code}`
          : code;

        await Bun.write(tempFile, fileContents);

        const sandboxEnv = buildSandboxEnv(env);
        const permFlags = buildPermissionFlags(config, Object.keys(sandboxEnv));

        // Spawn deno with timeout via AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);

        const proc = Bun.spawn(['deno', 'run', ...permFlags, tempFile], {
          cwd: config.workingDir,
          stdout: 'pipe',
          stderr: 'pipe',
          stdin: onToolCall ? 'pipe' : undefined,
          signal: controller.signal,
          env: sandboxEnv,
        });

        if (onToolCall) {
          // IPC mode: process stdout line-by-line.
          // Caveat: while a tool call is awaited below, stdout is not being
          // drained — sandbox code that floods debug()/output() concurrently
          // with a slow tool call can fill the pipe and block until the tool
          // returns. Tool handlers must never wait on further sandbox output.
          const outputs: unknown[] = [];
          const debugMessages: string[] = [];
          const rawLines: string[] = [];
          let toolCallCount = 0;
          const encoder = new TextEncoder();

          try {
            for await (const line of readLines(proc.stdout)) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Try to detect IPC messages by prefix
              if (trimmed.startsWith('{"__tool_call__"')) {
                try {
                  const msg = JSON.parse(trimmed) as {
                    __tool_call__: true;
                    tool: string;
                    params: Record<string, unknown>;
                  };

                  toolCallCount++;
                  if (toolCallCount > MAX_TOOL_CALLS) {
                    const errorResponse = JSON.stringify({
                      __tool_error__: `Tool call limit exceeded (max ${MAX_TOOL_CALLS})`,
                    });
                    proc.stdin.write(encoder.encode(errorResponse + '\n'));
                    proc.stdin.flush();
                    continue;
                  }

                  try {
                    const result = await onToolCall(msg.tool, msg.params);
                    const response = JSON.stringify({ __tool_result__: result });
                    proc.stdin.write(encoder.encode(response + '\n'));
                    proc.stdin.flush();
                  } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    const response = JSON.stringify({ __tool_error__: errorMsg });
                    proc.stdin.write(encoder.encode(response + '\n'));
                    proc.stdin.flush();
                  }
                } catch {
                  // JSON parse failed — treat as raw output
                  rawLines.push(trimmed);
                }
              } else if (trimmed.startsWith('{"__output__"')) {
                try {
                  const msg = JSON.parse(trimmed) as { __output__: unknown };
                  outputs.push(msg.__output__);
                } catch {
                  rawLines.push(trimmed);
                }
              } else if (trimmed.startsWith('{"__debug__"')) {
                try {
                  const msg = JSON.parse(trimmed) as { __debug__: string };
                  debugMessages.push(msg.__debug__);
                } catch {
                  rawLines.push(trimmed);
                }
              } else {
                rawLines.push(trimmed);
              }
            }
          } catch (streamErr) {
            const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            if (!msg.includes('abort')) {
              rawLines.push(`[stream error: ${msg}]`);
            }
          }

          // Collect stderr
          let stderr = '';
          try {
            stderr = await new Response(proc.stderr).text();
          } catch {
            stderr = '[stderr collection failed]';
          }

          clearTimeout(timeoutId);

          const exitCode = await proc.exited;
          const duration_ms = Math.round(performance.now() - startTime);

          // Build output: prefer last __output__ value, fall back to debug + raw
          let output: string;
          if (outputs.length > 0) {
            const lastOutput = outputs[outputs.length - 1];
            output = typeof lastOutput === 'string' ? lastOutput : JSON.stringify(lastOutput);
          } else {
            const parts = [...debugMessages, ...rawLines];
            output = parts.join('\n');
          }

          // Truncate
          if (output.length > config.maxOutputSize) {
            output = output.slice(0, config.maxOutputSize);
          }
          if (stderr.length > config.maxOutputSize) {
            stderr = stderr.slice(0, config.maxOutputSize);
          }

          if (timedOut) {
            return {
              success: false,
              output,
              error: `Execution timed out after ${config.timeoutMs}ms`,
              duration_ms,
            };
          }

          return {
            success: exitCode === 0,
            output,
            error: stderr.length > 0 ? stderr : null,
            duration_ms,
          };
        } else {
          // Simple mode: collect all stdout/stderr as before
          let stdout: string;
          let stderr: string;

          try {
            const [stdoutBuf, stderrBuf] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
            ]);
            stdout = stdoutBuf;
            stderr = stderrBuf;
          } catch {
            stdout = '';
            stderr = `Execution timed out after ${config.timeoutMs}ms`;
          }

          clearTimeout(timeoutId);

          const exitCode = await proc.exited;
          const duration_ms = Math.round(performance.now() - startTime);

          // Truncate output to maxOutputSize
          if (stdout.length > config.maxOutputSize) {
            stdout = stdout.slice(0, config.maxOutputSize);
          }
          if (stderr.length > config.maxOutputSize) {
            stderr = stderr.slice(0, config.maxOutputSize);
          }

          return {
            success: exitCode === 0,
            output: stdout,
            error: stderr.length > 0 ? stderr : null,
            duration_ms,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const duration_ms = Math.round(performance.now() - startTime);

        if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
          return {
            success: false,
            output: '',
            error: `Execution timed out after ${config.timeoutMs}ms`,
            duration_ms,
          };
        }

        return {
          success: false,
          output: '',
          error: message,
          duration_ms,
        };
      } finally {
        await unlink(tempFile).catch(() => {});
        if (stubsFile) await unlink(stubsFile).catch(() => {});
      }
    },
  };
}
