// pattern: UI Shell — unified tools, built-in tools, and skill management

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Store, GrantStatus } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { TuiDependencies } from '../types.ts';
import { parseDescription } from '../util.ts';
import { theme, separator } from '../theme.ts';
import ScreenLayout from '../ScreenLayout.tsx';
import StatusBar from '../StatusBar.tsx';
import { highlightCode } from '../syntax.ts';

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

function grantColor(status: GrantStatus): string {
  switch (status) {
    case 'granted':
      return theme.grantOk;
    case 'revoked':
      return theme.grantRevoked;
    default:
      return theme.grantPending;
  }
}

function grantIcon(status: GrantStatus): string {
  switch (status) {
    case 'granted':
      return '✓';
    case 'revoked':
      return '✗';
    default:
      return '○';
  }
}

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
  const [editSecretTarget, setEditSecretTarget] = useState<{ section: Section; name: string }>({ section: 'skills', name: '' });
  const [editSecretChecked, setEditSecretChecked] = useState<Set<string>>(new Set());
  const [editSecretIdx, setEditSecretIdx] = useState(0);
  const [codeScrollOffset, setCodeScrollOffset] = useState(0);

  const refreshSkills = useCallback(() => {
    const result = store.docList(500);
    const skillDocs = result.documents.filter((d) => d.rkey.startsWith('skill:'));
    const entries: Array<SkillEntry> = skillDocs.map((doc) => {
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

  const codeLines = mode === 'view_code' ? highlightCode(codeContent).split('\n') : [];
  const CODE_PAGE_SIZE = Math.max(5, termHeight - 6);

  useInput((input, key) => {
    if (mode === 'view_code') {
      if (key.escape) {
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
      if (key.escape) {
        const secretList = Array.from(editSecretChecked);
        if (editSecretTarget.section === 'skills') {
          store.updateGrantSecrets(editSecretTarget.name, secretList);
          refreshSkills();
        } else if (editSecretTarget.section === 'custom' && customTools) {
          customTools.updateSecrets(editSecretTarget.name, secretList);
        }
        setStatusMsg(`Updated secrets for ${editSecretTarget.name}`);
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
      } else if (input === 'v') {
        setCodeContent(tool.code);
        setCodeScrollOffset(0);
        setMode('view_code');
      } else if (input === 's') {
        setEditSecretTarget({ section: 'custom', name: tool.name });
        setEditSecretChecked(new Set(tool.secrets));
        setEditSecretIdx(0);
        setMode('edit_secrets');
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
        setEditSecretTarget({ section: 'skills', name: skill.rkey });
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
        <Text bold color={theme.heading}>
          Skill Code
        </Text>
        <Box>
          <Text color={theme.separator}>{separator(separatorWidth)}</Text>
        </Box>
        <Box flexDirection="column">
          {visibleLines.map((line, i) => {
            const lineNum = codeScrollOffset + i + 1;
            return (
              <Text key={codeScrollOffset + i}>
                <Text color={theme.dim}>{String(lineNum).padStart(4, ' ')} │ </Text>
                <Text>{line || ' '}</Text>
              </Text>
            );
          })}
        </Box>
        <StatusBar
          keys={[
            { key: 'j/k', label: 'scroll' },
            { key: 'C-d/u', label: 'page' },
            { key: 'g/G', label: 'top/bottom' },
            { key: 'Esc', label: 'back' },
          ]}
          status={`Lines ${codeScrollOffset + 1}–${lineEnd} of ${codeLines.length}`}
        />
      </Box>
    );
  }

  // ── Edit Secrets Mode ──
  if (mode === 'edit_secrets') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={theme.heading}>
          Secrets for: <Text color={theme.accentAlt}>{editSecretTarget.name}</Text>
        </Text>
        <Text color={theme.muted}>Space/Enter to toggle, Esc to save & go back</Text>
        <Box marginTop={1} flexDirection="column">
          {allSecretKeys.length === 0 ? (
            <Text color={theme.dim}>(no secrets in vault — add via the Secrets screen)</Text>
          ) : (
            allSecretKeys.map((k, i) => {
              const checked = editSecretChecked.has(k);
              const isSelected = i === editSecretIdx;
              return (
                <Text key={k}>
                  <Text color={isSelected ? theme.selected : theme.body}>
                    {isSelected ? '▸' : ' '} [{checked ? '✓' : ' '}] {k}
                  </Text>
                </Text>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // ── List Mode ──
  const renderTabs = (): React.ReactElement => (
    <Box>
      {SECTIONS.map((s) => {
        const label = s === 'custom' ? 'Custom' : s === 'builtin' ? 'Built-in' : 'Skills';
        const isActive = s === section;
        return (
          <Box key={s} marginRight={2}>
            <Text bold color={isActive ? theme.tabActive : theme.tabInactive}>
              {isActive ? '▸ ' : '  '}{label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );

  const renderCustomSection = (): React.ReactElement => {
    if (!customTools) {
      return <Text color={theme.dim}>(Custom tools not available)</Text>;
    }
    if (customToolList.length === 0) {
      return <Text color={theme.dim}>(no custom tools)</Text>;
    }
    return (
      <>
        {customToolList.map((tool, i) => {
          const isSelected = i === selectedIdx;
          const statusColor = tool.approved ? theme.grantOk : theme.grantPending;
          const icon = tool.approved ? '✓' : '○';
          const secretCount = tool.secrets.length;
          const secretSuffix = secretCount > 0 ? ` [${secretCount} secret${secretCount > 1 ? 's' : ''}]` : '';
          return (
            <Text key={tool.name}>
              <Text color={isSelected ? theme.selected : theme.body}>
                {isSelected ? '▸' : ' '}{' '}
              </Text>
              <Text color={statusColor}>{icon} </Text>
              <Text color={isSelected ? theme.selected : theme.body}>
                {tool.name}
              </Text>
              <Text color={theme.muted}> — {tool.description}{secretSuffix}</Text>
            </Text>
          );
        })}
      </>
    );
  };

  const renderBuiltinSection = (): React.ReactElement => {
    if (builtinTools.length === 0) {
      return <Text color={theme.dim}>(no built-in tools)</Text>;
    }
    return (
      <>
        {builtinTools.map((tool, i) => {
          const isSelected = i === selectedIdx;
          return (
            <Text key={tool.name}>
              <Text color={isSelected ? theme.selected : theme.body}>
                {isSelected ? '▸' : ' '} {tool.name}
              </Text>
              <Text color={theme.muted}> — {tool.description}</Text>
            </Text>
          );
        })}
      </>
    );
  };

  const renderSkillsSection = (): React.ReactElement => {
    if (skills.length === 0) {
      return <Text color={theme.dim}>(no skills)</Text>;
    }
    return (
      <>
        {skills.map((skill, i) => {
          const isSelected = i === selectedIdx;
          const desc = skill.description ? ` — ${skill.description}` : '';
          const secretCount = skill.secrets.length;
          const secretSuffix = secretCount > 0 ? ` [${secretCount} secret${secretCount > 1 ? 's' : ''}]` : '';
          return (
            <Text key={skill.rkey}>
              <Text color={isSelected ? theme.selected : theme.body}>
                {isSelected ? '▸' : ' '}{' '}
              </Text>
              <Text color={grantColor(skill.grantStatus)}>{grantIcon(skill.grantStatus)} </Text>
              <Text color={isSelected ? theme.selected : theme.body}>
                {skill.rkey}
              </Text>
              <Text color={theme.muted}>
                {desc}
                {secretSuffix}
              </Text>
            </Text>
          );
        })}
      </>
    );
  };

  const sectionKeys = ((): ReadonlyArray<{ key: string; label: string }> => {
    switch (section) {
      case 'custom':
        return [
          { key: 'a', label: 'approve' },
          { key: 'r', label: 'revoke' },
          { key: 'v', label: 'view' },
          { key: 's', label: 'secrets' },
        ];
      case 'builtin':
        return [];
      case 'skills':
        return [
          { key: 'g', label: 'grant' },
          { key: 'r', label: 'revoke' },
          { key: 'v', label: 'view' },
          { key: 's', label: 'secrets' },
          { key: 'd', label: 'delete' },
        ];
    }
  })();

  const headerContent = (
    <>
      <Box paddingX={1}>
        <Text bold color={theme.heading}>
          Tools
        </Text>
      </Box>
      <Box paddingX={1}>
        {renderTabs()}
      </Box>
      <Box paddingX={1}>
        <Text color={theme.separator}>{separator(60)}</Text>
      </Box>
    </>
  );

  return (
    <ScreenLayout
      header={headerContent}
      headerHeight={3}
      statusKeys={[
        { key: 'Tab', label: 'section' },
        { key: 'j/k', label: 'move' },
        ...sectionKeys,
        { key: 'Esc', label: 'back' },
      ]}
    >
      {statusMsg && <Text color={theme.warning}>{statusMsg}</Text>}
      {section === 'custom' && renderCustomSection()}
      {section === 'builtin' && renderBuiltinSection()}
      {section === 'skills' && renderSkillsSection()}
    </ScreenLayout>
  );
}
