// pattern: UI Shell — Skill review page for grant management

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Store, GrantStatus } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';

export type ReviewPageProps = {
  readonly store: Store;
  readonly secrets: SecretManager;
  readonly onExit: () => void;
};

type Mode = 'list' | 'view_code' | 'edit_secrets' | 'add_secret' | 'manage_vault';

type SecretInput = { key: string; value: string; step: 'key' | 'value' };

type SkillEntry = {
  rkey: string;
  content: string;
  description: string;
  grantStatus: GrantStatus;
  secrets: ReadonlyArray<string>;
};

/**
 * Parse a description from a skill document's header comment.
 * Looks for `// Description: ...` in the first few lines.
 */
function parseDescription(content: string): string {
  const lines = content.split('\n').slice(0, 10);
  for (const line of lines) {
    const match = line.match(/^\/\/\s*Description:\s*(.+)/i);
    if (match) return match[1]!.trim();
  }
  return '';
}

export default function ReviewPage({ store, secrets, onExit }: ReviewPageProps): React.ReactElement {
  const [skills, setSkills] = useState<Array<SkillEntry>>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [codeContent, setCodeContent] = useState('');
  const [secretInput, setSecretInput] = useState<SecretInput>({ key: '', value: '', step: 'key' });
  const [editSecretSkill, setEditSecretSkill] = useState('');
  const [editSecretChecked, setEditSecretChecked] = useState<Set<string>>(new Set());
  const [editSecretIdx, setEditSecretIdx] = useState(0);
  const [vaultIdx, setVaultIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const refresh = useCallback(() => {
    const result = store.docList(500);
    const skillDocs = result.documents.filter(d => d.rkey.startsWith('skill:'));
    const entries: SkillEntry[] = skillDocs.map(doc => {
      const grant = store.getGrant(doc.rkey);
      return {
        rkey: doc.rkey,
        content: doc.content,
        description: parseDescription(doc.content),
        grantStatus: (grant?.status as GrantStatus) ?? 'pending',
        secrets: grant?.secrets ?? [],
      };
    });
    setSkills(entries);
  }, [store]);

  useEffect(() => { refresh(); }, [refresh]);

  const selectedSkill = skills[selectedIdx];
  const allSecretKeys = secrets.listKeys();

  useInput((input, key) => {
    if (mode === 'add_secret') return; // text input handles keys

    if (mode === 'list') {
      if (key.escape || input === 'q') {
        onExit();
        return;
      }
      if (key.upArrow || input === 'k') {
        setSelectedIdx((i) => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setSelectedIdx((i) => Math.min(skills.length - 1, i + 1));
      }
      if (input === 'g' && selectedSkill) {
        store.updateGrantStatus(selectedSkill.rkey, 'granted');
        setStatusMsg(`✅ Granted: ${selectedSkill.rkey}`);
        refresh();
      }
      if (input === 'r' && selectedSkill) {
        store.updateGrantStatus(selectedSkill.rkey, 'revoked');
        setStatusMsg(`🔴 Revoked: ${selectedSkill.rkey}`);
        refresh();
      }
      if (input === 'v' && selectedSkill) {
        setCodeContent(selectedSkill.content);
        setMode('view_code');
      }
      if (input === 's' && selectedSkill) {
        setEditSecretSkill(selectedSkill.rkey);
        setEditSecretChecked(new Set(selectedSkill.secrets as string[]));
        setEditSecretIdx(0);
        setMode('edit_secrets');
      }
      if (input === 'a') {
        setSecretInput({ key: '', value: '', step: 'key' });
        setMode('add_secret');
      }
      if (input === 'm') {
        setVaultIdx(0);
        setMode('manage_vault');
      }
      if (input === 'd' && selectedSkill) {
        store.docDelete(selectedSkill.rkey);
        store.deleteGrant(selectedSkill.rkey);
        setStatusMsg(`🗑️ Deleted: ${selectedSkill.rkey}`);
        refresh();
        setSelectedIdx((i) => Math.max(0, i - 1));
      }
    }

    if (mode === 'view_code') {
      if (key.escape || input === 'q') {
        setMode('list');
      }
    }

    if (mode === 'edit_secrets') {
      if (key.escape || input === 'q') {
        // Save the updated secret assignments
        store.updateGrantSecrets(editSecretSkill, Array.from(editSecretChecked));
        setStatusMsg(`Updated secrets for ${editSecretSkill}`);
        refresh();
        setMode('list');
      }
      if (key.upArrow || input === 'k') {
        setEditSecretIdx((i) => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setEditSecretIdx((i) => Math.min(allSecretKeys.length - 1, i + 1));
      }
      if (input === ' ' || key.return) {
        const key_ = allSecretKeys[editSecretIdx];
        if (key_) {
          setEditSecretChecked((prev) => {
            const next = new Set(prev);
            if (next.has(key_)) next.delete(key_);
            else next.add(key_);
            return next;
          });
        }
      }
    }

    if (mode === 'manage_vault') {
      if (key.escape || input === 'q') {
        setMode('list');
      }
      if (key.upArrow || input === 'k') {
        setVaultIdx((i) => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setVaultIdx((i) => Math.min(allSecretKeys.length - 1, i + 1));
      }
      if (input === 'd') {
        const key_ = allSecretKeys[vaultIdx];
        if (key_) {
          secrets.remove(key_);
          setStatusMsg(`Removed secret: ${key_}`);
          setVaultIdx((i) => Math.max(0, i - 1));
        }
      }
    }
  });

  // ── Add Secret Mode ─────────────────────────────────────────────────────
  if (mode === 'add_secret') {
    const isKeyStep = secretInput.step === 'key';
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Add Secret</Text>
        <Box marginTop={1}>
          <Text>{isKeyStep ? 'Secret name: ' : `${secretInput.key} = `}</Text>
          <TextInput
            value={isKeyStep ? secretInput.key : secretInput.value}
            onChange={(val) => setSecretInput((prev) => isKeyStep ? { ...prev, key: val } : { ...prev, value: val })}
            onSubmit={(val) => {
              if (isKeyStep) {
                if (!val.trim()) { setMode('list'); return; }
                setSecretInput((prev) => ({ ...prev, key: val, step: 'value' }));
              } else {
                if (!val.trim()) { setMode('list'); return; }
                secrets.set(secretInput.key, val);
                setStatusMsg(`Secret "${secretInput.key}" saved.`);
                setMode('list');
              }
            }}
          />
        </Box>
        <Text dimColor>Enter to confirm, empty to cancel</Text>
      </Box>
    );
  }

  // ── View Code Mode ──────────────────────────────────────────────────────
  if (mode === 'view_code') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">{selectedSkill?.rkey ?? 'Skill Code'}</Text>
        <Box marginTop={1} flexDirection="column">
          {codeContent.split('\n').slice(0, 30).map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
          {codeContent.split('\n').length > 30 && <Text dimColor>... ({codeContent.split('\n').length} lines total)</Text>}
        </Box>
        <Box marginTop={1}><Text dimColor>Press q/Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── Edit Secrets Mode ───────────────────────────────────────────────────
  if (mode === 'edit_secrets') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Secrets for: {editSecretSkill}</Text>
        <Text dimColor>Space/Enter to toggle, q/Esc to save & go back</Text>
        <Box marginTop={1} flexDirection="column">
          {allSecretKeys.length === 0 ? (
            <Text dimColor>(no secrets in vault — press 'a' in list mode to add one)</Text>
          ) : (
            allSecretKeys.map((key, i) => {
              const checked = editSecretChecked.has(key);
              const cursor = i === editSecretIdx ? '>' : ' ';
              return (
                <Text key={key}>
                  {cursor} [{checked ? 'x' : ' '}] {key}
                </Text>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // ── Manage Vault Mode ───────────────────────────────────────────────────
  if (mode === 'manage_vault') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Secret Vault</Text>
        <Text dimColor>d=delete, q/Esc=back</Text>
        <Box marginTop={1} flexDirection="column">
          {allSecretKeys.length === 0 ? (
            <Text dimColor>(vault is empty)</Text>
          ) : (
            allSecretKeys.map((key, i) => {
              const cursor = i === vaultIdx ? '>' : ' ';
              return <Text key={key}>{cursor} {key}</Text>;
            })
          )}
        </Box>
      </Box>
    );
  }

  // ── List Mode (default) ─────────────────────────────────────────────────
  const statusIcon = (status: GrantStatus) =>
    status === 'granted' ? '✅' : status === 'revoked' ? '🔴' : '⏳';

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Skill Review</Text>
      <Text dimColor>g=grant r=revoke v=view s=secrets a=add-secret m=vault d=delete q=back</Text>

      {statusMsg && <Text color="yellow">{statusMsg}</Text>}

      <Box marginTop={1} flexDirection="column">
        {skills.length === 0 ? (
          <Text dimColor>(no skills)</Text>
        ) : (
          skills.map((skill, i) => {
            const cursor = i === selectedIdx ? '>' : ' ';
            const desc = skill.description ? ` — ${skill.description}` : '';
            const secretCount = skill.secrets.length;
            return (
              <Text key={skill.rkey}>
                {cursor} {statusIcon(skill.grantStatus)} {skill.rkey}{desc}
                {secretCount > 0 ? ` [${secretCount} secret${secretCount > 1 ? 's' : ''}]` : ''}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
