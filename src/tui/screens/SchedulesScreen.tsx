// pattern: UI Shell — scheduled task list with enable/disable

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TaskStore, TaskState } from '../../scheduler/types.ts';
import { formatDate } from '../util.ts';
import { theme } from '../theme.ts';
import ScreenLayout from '../ScreenLayout.tsx';

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

  const headerContent = (
    <Box paddingX={1}>
      <Text bold color={theme.heading}>
        Schedules
      </Text>
    </Box>
  );

  return (
    <ScreenLayout
      header={headerContent}
      headerHeight={1}
      statusKeys={[
        { key: 'j/k', label: 'move' },
        { key: 'e', label: 'toggle' },
        { key: 'Esc', label: 'back' },
      ]}
    >
      {tasks.length === 0 ? (
        <Text color={theme.dim}>(No scheduled tasks. The agent creates tasks via the schedule_task tool.)</Text>
      ) : (
        tasks.map((task, i) => {
          const isSelected = i === selectedIdx;
          const iconColor = task.enabled ? theme.taskOn : theme.taskOff;
          const icon = task.enabled ? '●' : '○';
          return (
            <Box key={task.id} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={isSelected ? theme.selected : theme.body}>
                  {isSelected ? '▸' : ' '}{' '}
                </Text>
                <Text color={iconColor}>{icon} </Text>
                <Text color={isSelected ? theme.selected : theme.body}>{task.name}</Text>
              </Text>
              <Text color={theme.muted}>     Schedule: {task.schedule}</Text>
              <Text color={theme.muted}>
                {'     '}Runs: {task.runCount} | Last: {renderLastRun(task)}
              </Text>
              {!task.enabled && <Text color={theme.warning}>     [DISABLED]</Text>}
            </Box>
          );
        })
      )}
    </ScreenLayout>
  );
}
