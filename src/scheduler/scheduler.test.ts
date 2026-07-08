import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createScheduler } from './scheduler.ts';
import type { ScheduledTask, TaskStore } from './types.ts';
import type { Agent, ChatResult } from '../agent/types.ts';

const PERSIST_DIR = join(import.meta.dir, '.test-scheduler');

function makeAgent(onChat?: () => void): Agent {
  return {
    chat: async (): Promise<ChatResult> => {
      onChat?.();
      return {
        text: 'ok',
        stats: {
          inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
          contextEstimate: 0, contextLimit: 0, rounds: 1, durationMs: 0,
        },
      };
    },
    reset: () => {},
  };
}

function makeTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'task-1',
    name: 'test task',
    prompt: 'do the thing',
    schedule: '0 0 1 1 *', // once a year — never fires during a test
    createdAt: new Date().toISOString(),
    enabled: true,
    ...overrides,
  };
}

function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('scheduler update/setEnabled', () => {
  const schedulers: Array<TaskStore> = [];

  afterEach(async () => {
    for (const s of schedulers.splice(0)) {
      await s.stop();
    }
    await rm(PERSIST_DIR, { recursive: true, force: true });
  });

  function makeScheduler(agent: Agent, persistName: string): TaskStore {
    const scheduler = createScheduler({
      agent,
      persistPath: join(PERSIST_DIR, persistName),
    });
    schedulers.push(scheduler);
    return scheduler;
  }

  test('update() applies a new schedule to legacy tasks with enabled === undefined', async () => {
    let fired = 0;
    const scheduler = makeScheduler(makeAgent(() => fired++), 'legacy.json');

    // Legacy task persisted before the enabled flag existed
    scheduler.schedule(makeTask({ enabled: undefined as unknown as boolean }));

    const updated = scheduler.update('task-1', { schedule: '1s' });
    expect(updated).toBe(true);
    expect(scheduler.get('task-1')?.schedule).toBe('1s');

    // The new every-second cron must actually fire — before the fix the old
    // yearly cron kept running and the new schedule was silently ignored.
    await waitFor(() => fired > 0);
  });

  test('update() does not resurrect a disabled task', async () => {
    let fired = 0;
    const scheduler = makeScheduler(makeAgent(() => fired++), 'disabled.json');

    scheduler.schedule(makeTask({ enabled: false }));
    scheduler.update('task-1', { schedule: '1s' });

    await new Promise((r) => setTimeout(r, 1_500));
    expect(fired).toBe(0);
  });

  test('setEnabled(true) on an already-running legacy task does not double-schedule', async () => {
    let fired = 0;
    const scheduler = makeScheduler(makeAgent(() => fired++), 'double.json');

    scheduler.schedule(makeTask({ schedule: '1s', enabled: undefined as unknown as boolean }));
    // Legacy task is already effectively enabled; this must be a no-op,
    // not a second live cron for the same task.
    scheduler.setEnabled('task-1', true);

    await waitFor(() => fired >= 2, 10_000);
    // Two crons firing every second would produce ~2x the runs; the run
    // counter tracks scheduler-level runs and must match what fired.
    expect(scheduler.get('task-1')?.runCount).toBe(fired);
  });

  test('stop() awaits runs started from an updated cron', async () => {
    let started = 0;
    let finished = 0;
    const agent: Agent = {
      chat: async (): Promise<ChatResult> => {
        started++;
        await new Promise((r) => setTimeout(r, 300));
        finished++;
        return {
          text: 'ok',
          stats: {
            inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
            contextEstimate: 0, contextLimit: 0, rounds: 1, durationMs: 0,
          },
        };
      },
      reset: () => {},
    };
    const scheduler = makeScheduler(agent, 'stop.json');

    scheduler.schedule(makeTask());
    scheduler.update('task-1', { schedule: '1s' });

    await waitFor(() => started > 0);
    await scheduler.stop();
    // Before the fix, crons recreated by update() bypassed inFlight
    // tracking and stop() returned while the run was still going.
    expect(finished).toBe(started);
  });
});
