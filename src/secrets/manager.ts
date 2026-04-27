// pattern: Imperative Shell — secret vault as a flat JSON file
//
// Secrets are name → value pairs stored locally.
// The agent can see secret names but never values.
// Values are injected as environment variables into Deno sandbox processes.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type SecretManager = {
  /** List secret names only (never values). */
  listKeys(): Array<string>;
  /** Get a secret value. Internal only — for env injection. */
  get(key: string): string | undefined;
  /** Set a secret. Resolves when persisted to disk. */
  set(key: string, value: string): Promise<void>;
  /** Delete a secret. Resolves when persisted to disk. */
  remove(key: string): Promise<void>;
  /** Resolve secrets for a skill → env var map. Takes an array of key names. */
  resolve(keys: ReadonlyArray<string>): Record<string, string>;
};

export function createSecretManager(path: string): SecretManager {
  let secrets: Record<string, string> = {};

  // Load synchronously on creation (called once at startup)
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      secrets = Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    }
  } catch {
    // File doesn't exist yet — start fresh
  }

  async function save(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(secrets, null, 2) + '\n');
  }

  return {
    listKeys(): Array<string> {
      return Object.keys(secrets).sort();
    },

    get(key: string): string | undefined {
      return secrets[key];
    },

    async set(key: string, value: string): Promise<void> {
      secrets[key] = value;
      await save();
    },

    async remove(key: string): Promise<void> {
      delete secrets[key];
      await save();
    },

    resolve(keys: ReadonlyArray<string>): Record<string, string> {
      const env: Record<string, string> = {};
      for (const key of keys) {
        const val = secrets[key];
        if (val !== undefined) {
          env[key] = val;
        }
      }
      return env;
    },
  };
}
