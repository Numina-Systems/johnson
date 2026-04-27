// pattern: Functional Core — shared parameter extraction helpers for tool handlers

export function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

export function optStr(input: Record<string, unknown>, key: string, fallback: string = ''): string {
  const val = input[key];
  return typeof val === 'string' ? val : fallback;
}
