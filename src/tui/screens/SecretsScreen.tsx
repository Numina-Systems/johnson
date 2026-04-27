// pattern: UI Shell — secret vault management (names only, never values)

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { SecretManager } from '../../secrets/manager.ts';
import type { Store } from '../../store/store.ts';

type SecretsScreenProps = {
  readonly secrets: SecretManager;
  readonly store: Store;
  readonly onBack: () => void;
};

type Mode = 'list' | 'add_name' | 'add_value';

export default function SecretsScreen(props: SecretsScreenProps): React.ReactElement {
  const { secrets, store, onBack } = props;

  const [mode, setMode] = useState<Mode>('list');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const keys = useMemo(() => secrets.listKeys(), [secrets, refreshTick]);

  const secretUsers = useMemo(() => {
    const map = new Map<string, string[]>();
    const grants = store.listGrants();
    for (const grant of grants) {
      for (const secretKey of grant.secrets) {
        const users = map.get(secretKey) ?? [];
        users.push(grant.skillName);
        map.set(secretKey, users);
      }
    }
    return map;
  }, [store, refreshTick]);

  useInput((input, key) => {
    if (mode !== 'list') return;

    if (key.escape) {
      onBack();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, keys.length - 1)));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (input === 'a') {
      setNewSecretName('');
      setNewSecretValue('');
      setMode('add_name');
    } else if (input === 'd') {
      const k = keys[selectedIdx];
      if (k) {
        secrets.remove(k).catch((err) => {
          setStatusMsg(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
        });
        setStatusMsg(`Removed: ${k}`);
        setSelectedIdx((i) => Math.max(0, i - 1));
        refresh();
      }
    }
  });

  // ── Add Name Mode ──
  if (mode === 'add_name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Add Secret
        </Text>
        <Box marginTop={1}>
          <Text>Secret name: </Text>
          <TextInput
            value={newSecretName}
            onChange={setNewSecretName}
            onSubmit={(val) => {
              const name = val.trim();
              if (!name) {
                setMode('list');
                return;
              }
              setNewSecretName(name);
              setMode('add_value');
            }}
          />
        </Box>
        <Text dimColor>Enter to confirm, empty to cancel</Text>
      </Box>
    );
  }

  // ── Add Value Mode ──
  if (mode === 'add_value') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Add Secret
        </Text>
        <Box marginTop={1}>
          <Text>{newSecretName} = </Text>
          <TextInput
            value={newSecretValue}
            onChange={setNewSecretValue}
            onSubmit={(val) => {
              if (!val.trim()) {
                setMode('list');
                return;
              }
              secrets
                .set(newSecretName, val)
                .then(() => {
                  setStatusMsg(`Saved: ${newSecretName}`);
                  refresh();
                })
                .catch((err) => {
                  setStatusMsg(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
                });
              setMode('list');
            }}
          />
        </Box>
        <Text dimColor>Enter to confirm, empty to cancel</Text>
      </Box>
    );
  }

  // ── List Mode ──
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Secrets
      </Text>
      {statusMsg && <Text color="yellow">{statusMsg}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {keys.length === 0 ? (
          <Text dimColor>(No secrets configured. Press 'a' to add one.)</Text>
        ) : (
          keys.map((k, i) => {
            const cursor = i === selectedIdx ? '>' : ' ';
            const users = secretUsers.get(k) ?? [];
            const usedBy = users.length > 0 ? `used by: ${users.join(', ')}` : '(not referenced)';
            return (
              <Box key={k}>
                <Text>
                  {cursor} {k}
                </Text>
                <Text color="gray">
                  {'  '}
                  {usedBy}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text color="gray">a=add d=delete Esc=back</Text>
      </Box>
    </Box>
  );
}
