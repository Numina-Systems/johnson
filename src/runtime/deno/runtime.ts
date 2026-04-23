/// <reference lib="deno.ns" />
// pattern: IPC Bridge (Deno sandbox side)
//
// This file runs INSIDE the Deno sandbox. It provides callTool(), output(),
// and debug() functions that agent code uses to communicate with the parent
// Bun process via stdin/stdout newline-delimited JSON.
//
// Protocol:
//   Tool call: write {"__tool_call__": true, "tool": "...", "params": {...}} to stdout
//              read  {"__tool_result__": ...} or {"__tool_error__": "..."} from stdin
//   Output:    write {"__output__": value} to stdout (no response expected)
//   Debug:     write {"__debug__": "message"} to stdout (no response expected)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let stdinBuffer = "";

/**
 * Read a single newline-delimited line from Deno.stdin.
 * Buffers partial reads and returns complete lines.
 */
async function readLine(): Promise<string> {
  // Check for an already-complete line in the buffer
  const newlineIndex = stdinBuffer.indexOf("\n");
  if (newlineIndex !== -1) {
    const line = stdinBuffer.slice(0, newlineIndex);
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    return line;
  }

  // Read chunks from stdin until we get a complete line
  const chunk = new Uint8Array(1024 * 64);
  while (true) {
    const bytesRead = await Deno.stdin.read(chunk);
    if (bytesRead === null) {
      // EOF — return any remaining buffered data or throw
      const remaining = stdinBuffer;
      stdinBuffer = "";
      if (remaining.length > 0) {
        return remaining;
      }
      throw new Error("Unexpected EOF while waiting for tool response");
    }

    stdinBuffer += decoder.decode(chunk.subarray(0, bytesRead));

    const idx = stdinBuffer.indexOf("\n");
    if (idx !== -1) {
      const line = stdinBuffer.slice(0, idx);
      stdinBuffer = stdinBuffer.slice(idx + 1);
      return line;
    }
  }
}

/**
 * Call a tool on the parent Bun process and await its result.
 *
 * Writes a JSON tool-call request to stdout and blocks until
 * the parent responds with a result or error on stdin.
 */
export async function callTool<T>(
  tool: string,
  params: Record<string, unknown>,
): Promise<T> {
  const request = JSON.stringify({ __tool_call__: true, tool, params });
  await Deno.stdout.write(encoder.encode(request + "\n"));

  const line = await readLine();

  let response: { __tool_result__?: T; __tool_error__?: string };
  try {
    response = JSON.parse(line);
  } catch {
    throw new Error(`Invalid JSON response from parent process: ${line}`);
  }

  if ("__tool_error__" in response && response.__tool_error__ !== undefined) {
    throw new Error(response.__tool_error__);
  }

  if (!("__tool_result__" in response)) {
    throw new Error(`Invalid response format: ${line}`);
  }

  return response.__tool_result__ as T;
}

/**
 * Send an output value to the parent process.
 * Synchronous — does not wait for a response.
 */
export function output(value: unknown): void {
  const message = JSON.stringify({ __output__: value });
  Deno.stdout.writeSync(encoder.encode(message + "\n"));
}

/**
 * Send a debug message to the parent process.
 * Synchronous — does not wait for a response.
 * Accepts multiple arguments, stringified and joined with spaces.
 */
export function debug(...args: unknown[]): void {
  const message = JSON.stringify({
    __debug__: args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" "),
  });
  Deno.stdout.writeSync(encoder.encode(message + "\n"));
}
