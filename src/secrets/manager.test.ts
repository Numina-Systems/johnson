// Integration tests for SecretManager — verifies persistence lifecycle against real filesystem.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSecretManager } from './manager.ts';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

const TEST_DIR = join(import.meta.dir, '../../.test-tmp');
const TEST_PATH = join(TEST_DIR, 'secrets.json');

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true });
  } catch {
    // ignore if doesn't exist
  }
}

describe('SecretManager', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test('set() persists to JSON file on disk', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('FOO', 'bar');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ FOO: 'bar' });
  });

  test('set() returns a Promise', () => {
    const mgr = createSecretManager(TEST_PATH);
    const result = mgr.set('X', 'Y');
    expect(result).toBeInstanceOf(Promise);
  });

  test('remove() returns a Promise', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('X', 'Y');
    const result = mgr.remove('X');
    expect(result).toBeInstanceOf(Promise);
  });

  test('get() retrieves a previously set value', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('TOKEN', 'abc123');
    expect(mgr.get('TOKEN')).toBe('abc123');
  });

  test('get() returns undefined for missing keys', () => {
    const mgr = createSecretManager(TEST_PATH);
    expect(mgr.get('NONEXISTENT')).toBeUndefined();
  });

  test('remove() deletes a secret and persists', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('DEL_ME', 'gone');
    await mgr.remove('DEL_ME');

    expect(mgr.get('DEL_ME')).toBeUndefined();

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({});
  });

  test('listKeys() returns sorted key names', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('ZEBRA', 'z');
    await mgr.set('ALPHA', 'a');
    await mgr.set('MIDDLE', 'm');

    expect(mgr.listKeys()).toEqual(['ALPHA', 'MIDDLE', 'ZEBRA']);
  });

  test('resolve() returns env map for existing keys, skips missing', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('FOO', 'bar');
    await mgr.set('BAZ', 'qux');

    const env = mgr.resolve(['FOO', 'MISSING', 'BAZ']);
    expect(env).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  test('resolve() returns empty object when no keys match', () => {
    const mgr = createSecretManager(TEST_PATH);
    const env = mgr.resolve(['NOTHING', 'NOPE']);
    expect(env).toEqual({});
  });

  test('new manager loads persisted secrets from disk', async () => {
    const mgr1 = createSecretManager(TEST_PATH);
    await mgr1.set('PERSIST', 'across-instances');

    const mgr2 = createSecretManager(TEST_PATH);
    expect(mgr2.get('PERSIST')).toBe('across-instances');
    expect(mgr2.listKeys()).toEqual(['PERSIST']);
  });

  test('set() overwrites existing value', async () => {
    const mgr = createSecretManager(TEST_PATH);
    await mgr.set('KEY', 'old');
    await mgr.set('KEY', 'new');

    expect(mgr.get('KEY')).toBe('new');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ KEY: 'new' });
  });

  test('creates parent directory if it does not exist', async () => {
    const nested = join(TEST_DIR, 'deep', 'nested', 'secrets.json');
    const mgr = createSecretManager(nested);
    await mgr.set('DEEP', 'value');

    const raw = readFileSync(nested, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toEqual({ DEEP: 'value' });
  });

  test('ignoring returned promise does not throw (backward compat)', () => {
    const mgr = createSecretManager(TEST_PATH);
    // Existing callers call set()/remove() without await — this must not throw
    mgr.set('IGNORED', 'promise');
    mgr.remove('IGNORED');
    // If we get here without error, backward compat is satisfied
  });
});
