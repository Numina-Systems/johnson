// pattern: UI Shell — secret vault management (names only, never values)

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { SecretManager } from '../../secrets/manager.ts';
import type { Store } from '../../store/store.ts';
import type { CustomToolManager } from '../../tools/custom-tool-manager.ts';

type SecretsScreenProps = {
  readonly secrets: SecretManager;
  readonly store: Store;
  readonly customTools?: CustomToolManager;
  readonly onBack: () => void;
};

type Mode = 'list' | 'add_name' | 'add_value' | 'edit_skills';

export default function SecretsScreen(props: SecretsScreenProps): React.ReactElement {
  const { secrets, store, customTools, onBack } = props;

  const [mode, setMode] = useState<Mode>('list');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [editSkillsSecret, setEditSkillsSecret] = useState('');
  const [editSkillsChecked, setEditSkillsChecked] = useState<Set<string>>(new Set());
  const [editSkillsIdx, setEditSkillsIdx] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const keys = useMemo(() => secrets.listKeys(), [secrets, refreshTick]);

  const assignableNames = useMemo(() => {
    const result = store.docList(500);
    const skills = result.documents
      .filter((d) => d.rkey.startsWith('skill:'))
      .map((d) => d.rkey);
    const tools = (customTools?.listTools() ?? []).map((t) => `customtool:${t.name}`);
    return [...skills, ...tools];
  }, [store, customTools, refreshTick]);

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
    for (const tool of customTools?.listTools() ?? []) {
      for (const secretKey of tool.secrets) {
        const users = map.get(secretKey) ?? [];
        users.push(`customtool:${tool.name}`);
        map.set(secretKey, users);
      }
    }
    return map;
  }, [store, customTools, refreshTick]);

  useInput((input, key) => {
    if (mode === 'edit_skills') {
      if (key.escape) {
        const grantMap = new Map(store.listGrants().map((g) => [g.skillName, g]));
        for (const name of assignableNames) {
          const shouldHave = editSkillsChecked.has(name);
          if (name.startsWith('customtool:') && customTools) {
            const toolName = name.slice('customtool:'.length);
            const tool = customTools.getTool(toolName);
            const currentSecrets = tool?.secrets ?? [];
            const hasSecret = currentSecrets.includes(editSkillsSecret);
            if (hasSecret && !shouldHave) {
              customTools.updateSecrets(toolName, currentSecrets.filter((s) => s !== editSkillsSecret));
            } else if (!hasSecret && shouldHave) {
              customTools.updateSecrets(toolName, [...currentSecrets, editSkillsSecret]);
            }
          } else {
            const grant = grantMap.get(name);
            const currentSecrets = grant?.secrets ?? [];
            const hasSecret = currentSecrets.includes(editSkillsSecret);
            if (hasSecret && !shouldHave) {
              store.updateGrantSecrets(name, currentSecrets.filter((s) => s !== editSkillsSecret));
            } else if (!hasSecret && shouldHave) {
              store.updateGrantSecrets(name, [...currentSecrets, editSkillsSecret]);
            }
          }
        }
        setStatusMsg(`Updated assignments for ${editSkillsSecret}`);
        refresh();
        setMode('list');
        return;
      }
      if (key.upArrow || input === 'k') {
        setEditSkillsIdx((i) => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setEditSkillsIdx((i) => Math.min(assignableNames.length - 1, i + 1));
      }
      if (input === ' ' || key.return) {
        const target = assignableNames[editSkillsIdx];
        if (target) {
          setEditSkillsChecked((prev) => {
            const next = new Set(prev);
            if (next.has(target)) next.delete(target);
            else next.add(target);
            return next;
          });
        }
      }
      return;
    }

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
    } else if (input === 's') {
      const k = keys[selectedIdx];
      if (k && assignableNames.length > 0) {
        const grants = store.listGrants();
        const checked = new Set<string>();
        for (const grant of grants) {
          if (grant.secrets.includes(k)) checked.add(grant.skillName);
        }
        for (const tool of customTools?.listTools() ?? []) {
          if (tool.secrets.includes(k)) checked.add(`customtool:${tool.name}`);
        }
        setEditSkillsSecret(k);
        setEditSkillsChecked(checked);
        setEditSkillsIdx(0);
        setMode('edit_skills');
      } else if (k && assignableNames.length === 0) {
        setStatusMsg('No skills or tools to assign — create one first');
      }
    } else if (input === 'd') {
      const k = keys[selectedIdx];
      if (k) {
        void (async () => {
          try {
            await secrets.remove(k);
            setStatusMsg(`Removed: ${k}`);
            setSelectedIdx((i) => Math.max(0, i - 1));
            refresh();
          } catch (err) {
            setStatusMsg(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
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

  // ── Edit Skills Mode ──
  if (mode === 'edit_skills') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Assign tools for: {editSkillsSecret}
        </Text>
        <Text dimColor>Space/Enter to toggle, Esc to save & go back</Text>
        <Box marginTop={1} flexDirection="column">
          {assignableNames.length === 0 ? (
            <Text dimColor>(no skills or tools — create one first)</Text>
          ) : (
            assignableNames.map((name, i) => {
              const checked = editSkillsChecked.has(name);
              const cursor = i === editSkillsIdx ? '>' : ' ';
              return (
                <Text key={name}>
                  {cursor} [{checked ? 'x' : ' '}] {name}
                </Text>
              );
            })
          )}
        </Box>
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
        <Text color="gray">a=add d=delete s=assign tools Esc=back</Text>
      </Box>
    </Box>
  );
}
