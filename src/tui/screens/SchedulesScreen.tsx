// pattern: UI Shell — scheduled task list with enable/disable

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TaskStore, TaskState } from '../../scheduler/types.ts';
import { formatDate } from '../util.ts';

type SchedulesScreenProps = {
  readonly scheduler: TaskStore;
  readonly onBack: () => void;
};

export default function SchedulesScreen(props: SchedulesScreenProps): React.ReactElement {
  const { scheduler, onBack } = props;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [tasks, setTasks] = useState<ReadonlyArray<TaskState>>([]);

  const refresh = useCallback(() => {
    setTasks(scheduler.list());
  }, [scheduler]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, tasks.length - 1)));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (input === 'e') {
      const task = tasks[selectedIdx];
      if (task) {
        scheduler.setEnabled(task.id, !task.enabled);
        refresh();
      }
    }
  });

  const renderLastRun = (task: TaskState): string => {
    if (!task.lastRun) return 'Never run';
    const status = task.lastRun.success ? 'OK' : 'FAIL';
    const dur = (task.lastRun.durationMs / 1000).toFixed(1);
    return `${formatDate(task.lastRun.startedAt)} ${status} (${dur}s)`;
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Schedules
      </Text>
      <Box>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {tasks.length === 0 ? (
          <Text dimColor>(No scheduled tasks. The agent creates tasks via the schedule_task tool.)</Text>
        ) : (
          tasks.map((task, i) => {
            const cursor = i === selectedIdx ? '>' : ' ';
            const icon = task.enabled ? 'ON ' : 'OFF';
            return (
              <Box key={task.id} flexDirection="column" marginBottom={1}>
                <Text>
                  {cursor} {icon} {task.name}
                </Text>
                <Text color="gray">     Schedule: {task.schedule}</Text>
                <Text color="gray">
                  {'     '}Runs: {task.runCount} | Last: {renderLastRun(task)}
                </Text>
                {!task.enabled && <Text color="yellow">     [DISABLED]</Text>}
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text color="gray">e=toggle enabled Esc=back</Text>
      </Box>
    </Box>
  );
}
