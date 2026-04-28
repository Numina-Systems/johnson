// pattern: UI Shell — unified tools, built-in tools, and skill management

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Store, GrantStatus } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { TuiDependencies } from '../types.ts';
import { parseDescription } from '../util.ts';

type ToolsScreenProps = {
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly customTools?: TuiDependencies['customTools'];
  readonly builtinTools: ReadonlyArray<{ name: string; description: string }>;
  readonly onBack: () => void;
  readonly onSubModeChange?: (active: boolean) => void;
};

type Section = 'custom' | 'builtin' | 'skills';
type Mode = 'list' | 'view_code' | 'edit_secrets';

type SkillEntry = {
  readonly rkey: string;
  readonly content: string;
  readonly description: string;
  readonly grantStatus: GrantStatus;
  readonly secrets: ReadonlyArray<string>;
};

const SECTIONS: ReadonlyArray<Section> = ['custom', 'builtin', 'skills'];

export default function ToolsScreen(props: ToolsScreenProps): React.ReactElement {
  const { store, secrets, customTools, builtinTools, onSubModeChange } = props;

  const [section, setSection] = useState<Section>('custom');
  const [mode, setMode] = useState<Mode>('list');

  useEffect(() => {
    onSubModeChange?.(mode !== 'list');
    return () => onSubModeChange?.(false);
  }, [mode, onSubModeChange]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const [skills, setSkills] = useState<ReadonlyArray<SkillEntry>>([]);
  const [codeContent, setCodeContent] = useState('');
  const [editSecretSkill, setEditSecretSkill] = useState('');
  const [editSecretChecked, setEditSecretChecked] = useState<Set<string>>(new Set());
  const [editSecretIdx, setEditSecretIdx] = useState(0);
  const [codeScrollOffset, setCodeScrollOffset] = useState(0);

  const refreshSkills = useCallback(() => {
    const result = store.docList(500);
    const skillDocs = result.documents.filter((d) => d.rkey.startsWith('skill:'));
    const entries: SkillEntry[] = skillDocs.map((doc) => {
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

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  const customToolList = customTools?.listTools() ?? [];
  const allSecretKeys = secrets?.listKeys() ?? [];

  const itemCount = (() => {
    switch (section) {
      case 'custom':
        return customToolList.length;
      case 'builtin':
        return builtinTools.length;
      case 'skills':
        return skills.length;
    }
  })();

  // Reset selection when section changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [section]);

  const cycleSection = useCallback((forward: boolean) => {
    setSection((cur) => {
      const idx = SECTIONS.indexOf(cur);
      const nextIdx = forward
        ? (idx + 1) % SECTIONS.length
        : (idx - 1 + SECTIONS.length) % SECTIONS.length;
      return SECTIONS[nextIdx]!;
    });
  }, []);

  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const termWidth = stdout?.columns ?? 80;

  const codeLines = mode === 'view_code' ? codeContent.split('\n') : [];
  const CODE_PAGE_SIZE = Math.max(5, termHeight - 6);

  useInput((input, key) => {
    if (mode === 'view_code') {
      if (key.escape || input === 'q') {
        setCodeScrollOffset(0);
        setMode('list');
        return;
      }
      const maxOffset = Math.max(0, codeLines.length - CODE_PAGE_SIZE);
      if (input === 'j' || key.downArrow) {
        setCodeScrollOffset((o) => Math.min(o + 1, maxOffset));
      } else if (input === 'k' || key.upArrow) {
        setCodeScrollOffset((o) => Math.max(o - 1, 0));
      } else if (input === 'd' && key.ctrl) {
        setCodeScrollOffset((o) => Math.min(o + Math.floor(CODE_PAGE_SIZE / 2), maxOffset));
      } else if (input === 'u' && key.ctrl) {
        setCodeScrollOffset((o) => Math.max(o - Math.floor(CODE_PAGE_SIZE / 2), 0));
      } else if (input === 'g') {
        setCodeScrollOffset(0);
      } else if (input === 'G') {
        setCodeScrollOffset(maxOffset);
      }
      return;
    }

    if (mode === 'edit_secrets') {
      if (key.escape || input === 'q') {
        store.updateGrantSecrets(editSecretSkill, Array.from(editSecretChecked));
        setStatusMsg(`Updated secrets for ${editSecretSkill}`);
        refreshSkills();
        setMode('list');
        return;
      }
      if (key.upArrow || input === 'k') {
        setEditSecretIdx((i) => Math.max(0, i - 1));
      }
      if (key.downArrow || input === 'j') {
        setEditSecretIdx((i) => Math.min(allSecretKeys.length - 1, i + 1));
      }
      if (input === ' ' || key.return) {
        const k = allSecretKeys[editSecretIdx];
        if (k) {
          setEditSecretChecked((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          });
        }
      }
      return;
    }

    // list mode
    if (key.tab && key.shift) {
      cycleSection(false);
      return;
    }
    if (key.tab) {
      cycleSection(true);
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, itemCount - 1)));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }

    if (section === 'custom' && customTools) {
      const tool = customToolList[selectedIdx];
      if (!tool) return;
      if (input === 'a') {
        customTools.approveTool(tool.name);
        setStatusMsg(`Approved: ${tool.name}`);
      } else if (input === 'r') {
        customTools.revokeTool(tool.name);
        setStatusMsg(`Revoked: ${tool.name}`);
      }
      return;
    }

    if (section === 'skills') {
      const skill = skills[selectedIdx];
      if (!skill) return;
      if (input === 'g') {
        store.updateGrantStatus(skill.rkey, 'granted');
        setStatusMsg(`Granted: ${skill.rkey}`);
        refreshSkills();
      } else if (input === 'r') {
        store.updateGrantStatus(skill.rkey, 'revoked');
        setStatusMsg(`Revoked: ${skill.rkey}`);
        refreshSkills();
      } else if (input === 'v') {
        setCodeContent(skill.content);
        setCodeScrollOffset(0);
        setMode('view_code');
      } else if (input === 's') {
        setEditSecretSkill(skill.rkey);
        setEditSecretChecked(new Set(skill.secrets));
        setEditSecretIdx(0);
        setMode('edit_secrets');
      } else if (input === 'd') {
        store.docDelete(skill.rkey);
        store.deleteGrant(skill.rkey);
        setStatusMsg(`Deleted: ${skill.rkey}`);
        refreshSkills();
        setSelectedIdx((i) => Math.max(0, i - 1));
      }
    }
  });

  // ── View Code Mode ──
  if (mode === 'view_code') {
    const visibleLines = codeLines.slice(codeScrollOffset, codeScrollOffset + CODE_PAGE_SIZE);
    const lineEnd = Math.min(codeScrollOffset + CODE_PAGE_SIZE, codeLines.length);
    const separatorWidth = Math.max(20, termWidth - 4);
    return (
      <Box flexDirection="column" padding={1} width={termWidth}>
        <Text bold color="cyan">
          Skill Code
        </Text>
        <Box>
          <Text dimColor>{'─'.repeat(separatorWidth)}</Text>
        </Box>
        <Box flexDirection="column">
          {visibleLines.map((line, i) => (
            <Text key={codeScrollOffset + i} dimColor>
              {line || ' '}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{'─'.repeat(separatorWidth)}</Text>
        </Box>
        <Box>
          <Text color="gray">
            Lines {codeScrollOffset + 1}–{lineEnd} of {codeLines.length} | j/k=scroll Ctrl-d/u=page g/G=top/bottom q/Esc=back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Edit Secrets Mode ──
  if (mode === 'edit_secrets') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          Secrets for: {editSecretSkill}
        </Text>
        <Text dimColor>Space/Enter to toggle, q/Esc to save & go back</Text>
        <Box marginTop={1} flexDirection="column">
          {allSecretKeys.length === 0 ? (
            <Text dimColor>(no secrets in vault — add via the Secrets screen)</Text>
          ) : (
            allSecretKeys.map((k, i) => {
              const checked = editSecretChecked.has(k);
              const cursor = i === editSecretIdx ? '>' : ' ';
              return (
                <Text key={k}>
                  {cursor} [{checked ? 'x' : ' '}] {k}
                </Text>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // ── List Mode ──
  const statusIcon = (status: GrantStatus): string =>
    status === 'granted' ? 'OK ' : status === 'revoked' ? 'REV' : 'PEN';

  const renderTabs = (): React.ReactElement => (
    <Box>
      {SECTIONS.map((s) => (
        <Box key={s} marginRight={2}>
          <Text bold color={s === section ? 'cyan' : 'gray'}>
            [{s === 'custom' ? 'Custom' : s === 'builtin' ? 'Built-in' : 'Skills'}]
          </Text>
        </Box>
      ))}
    </Box>
  );

  const renderCustomSection = (): React.ReactElement => {
    if (!customTools) {
      return <Text dimColor>(Custom tools not available — feature #10 not enabled)</Text>;
    }
    if (customToolList.length === 0) {
      return <Text dimColor>(no custom tools)</Text>;
    }
    return (
      <>
        {customToolList.map((tool, i) => {
          const cursor = i === selectedIdx ? '>' : ' ';
          const icon = tool.approved ? 'OK ' : 'PEN';
          return (
            <Text key={tool.name}>
              {cursor} {icon} {tool.name} — {tool.description}
            </Text>
          );
        })}
      </>
    );
  };

  const renderBuiltinSection = (): React.ReactElement => {
    if (builtinTools.length === 0) {
      return <Text dimColor>(no built-in tools)</Text>;
    }
    return (
      <>
        {builtinTools.map((tool, i) => {
          const cursor = i === selectedIdx ? '>' : ' ';
          return (
            <Text key={tool.name}>
              {cursor} {tool.name} — {tool.description}
            </Text>
          );
        })}
      </>
    );
  };

  const renderSkillsSection = (): React.ReactElement => {
    if (skills.length === 0) {
      return <Text dimColor>(no skills)</Text>;
    }
    return (
      <>
        {skills.map((skill, i) => {
          const cursor = i === selectedIdx ? '>' : ' ';
          const desc = skill.description ? ` — ${skill.description}` : '';
          const secretCount = skill.secrets.length;
          const secretSuffix = secretCount > 0 ? ` [${secretCount} secret${secretCount > 1 ? 's' : ''}]` : '';
          return (
            <Text key={skill.rkey}>
              {cursor} {statusIcon(skill.grantStatus)} {skill.rkey}
              {desc}
              {secretSuffix}
            </Text>
          );
        })}
      </>
    );
  };

  const sectionFooter = (() => {
    switch (section) {
      case 'custom':
        return 'a=approve r=revoke';
      case 'builtin':
        return '(read-only)';
      case 'skills':
        return 'g=grant r=revoke v=view s=secrets d=delete';
    }
  })();

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Tools
      </Text>
      {renderTabs()}
      <Box>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      {statusMsg && <Text color="yellow">{statusMsg}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {section === 'custom' && renderCustomSection()}
        {section === 'builtin' && renderBuiltinSection()}
        {section === 'skills' && renderSkillsSection()}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
      <Box>
        <Text color="gray">
          Tab=section j/k=move {sectionFooter} Esc=back
        </Text>
      </Box>
    </Box>
  );
}
