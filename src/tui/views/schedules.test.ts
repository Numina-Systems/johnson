import { describe, it, expect } from 'bun:test';
import type { TaskState } from '../../scheduler/types.ts';
import { formatTaskLine } from './schedules.ts';
import { palette } from '../theme.ts';

describe('formatTaskLine', () => {
  it('formats enabled task with green bullet', () => {
    const task: TaskState = {
      id: 'task-1',
      name: 'daily-summary',
      prompt: 'summarize',
      schedule: '0 9 * * *',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: true,
      runCount: 3,
    };

    const result = formatTaskLine(task);

    expect(result).toContain('●');
    expect(result).toContain(palette.green);
    expect(result).toContain('daily-summary');
    expect(result).toContain('0 9 * * *');
    expect(result).toContain('(3 runs)');
  });

  it('formats disabled task with dim circle', () => {
    const task: TaskState = {
      id: 'task-2',
      name: 'weekly-report',
      prompt: 'report',
      schedule: '0 9 * * 1',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: false,
      runCount: 1,
    };

    const result = formatTaskLine(task);

    expect(result).toContain('○');
    expect(result).toContain(palette.overlay0);
    expect(result).toContain('weekly-report');
    expect(result).toContain('0 9 * * 1');
  });

  it('shows task with last run info (success)', () => {
    const task: TaskState = {
      id: 'task-3',
      name: 'cleanup',
      prompt: 'cleanup',
      schedule: '0 2 * * *',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: true,
      runCount: 5,
      lastRun: {
        taskId: 'task-3',
        startedAt: '2026-05-11T02:00:00Z',
        output: 'cleaned up 5 files',
        success: true,
        durationMs: 1200,
      },
    };

    const now = new Date('2026-05-11T10:00:00Z');
    const result = formatTaskLine(task, now);

    expect(result).toContain('cleanup');
    expect(result).toContain('OK');
    expect(result).toContain('1.2s');
  });

  it('shows task with last run info (failure)', () => {
    const task: TaskState = {
      id: 'task-4',
      name: 'backup',
      prompt: 'backup',
      schedule: '0 3 * * *',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: true,
      runCount: 2,
      lastRun: {
        taskId: 'task-4',
        startedAt: '2026-05-10T03:00:00Z',
        output: 'backup failed',
        success: false,
        durationMs: 5000,
      },
    };

    const now = new Date('2026-05-11T10:00:00Z');
    const result = formatTaskLine(task, now);

    expect(result).toContain('backup');
    expect(result).toContain('FAIL');
    expect(result).toContain('5.0s');
  });

  it('shows "Never run" for task without last run', () => {
    const task: TaskState = {
      id: 'task-5',
      name: 'new-task',
      prompt: 'new',
      schedule: '0 12 * * *',
      createdAt: '2026-05-11T10:00:00Z',
      enabled: true,
      runCount: 0,
    };

    const result = formatTaskLine(task);

    expect(result).toContain('new-task');
    expect(result).toContain('Never run');
  });

  it('includes run count in parentheses', () => {
    const task: TaskState = {
      id: 'task-6',
      name: 'test',
      prompt: 'test',
      schedule: '0 0 * * *',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: true,
      runCount: 42,
    };

    const result = formatTaskLine(task);

    expect(result).toContain('(42 runs)');
  });

  it('is a pure function with deterministic output', () => {
    const now = new Date('2026-05-11T10:00:00Z');
    const task: TaskState = {
      id: 'task-7',
      name: 'deterministic',
      prompt: 'test',
      schedule: '0 9 * * *',
      createdAt: '2026-05-01T10:00:00Z',
      enabled: true,
      runCount: 3,
      lastRun: {
        taskId: 'task-7',
        startedAt: '2026-05-11T09:00:00Z',
        output: 'done',
        success: true,
        durationMs: 500,
      },
    };

    const result1 = formatTaskLine(task, now);
    const result2 = formatTaskLine(task, now);

    expect(result1).toEqual(result2);
  });
});
