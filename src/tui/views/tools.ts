// pattern: Imperative Shell — tools view with section cycling, code viewer, and secret assignment

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store, GrantRow } from '../../store/store.ts';
import type { CustomToolManager, CustomTool } from '../../tools/custom-tool-manager.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createScrollableViewer } from '../widgets/scrollable-viewer.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';
import { highlightCode } from '../syntax.ts';
import { parseDescription } from '../util.ts';

// pattern: Functional Core — format grant status icon
export function formatGrantIcon(status: string | undefined, pal: typeof palette): string {
  if (status === 'granted') {
    return `{${pal.green}-fg}✓{/}`;
  }
  if (status === 'revoked') {
    return `{${pal.red}-fg}✗{/}`;
  }
  // pending or undefined
  return `{${pal.peach}-fg}○{/}`;
}

// pattern: Functional Core — format custom tool approval status
export function formatCustomToolStatus(approved: boolean, pal: typeof palette): string {
  return approved ? `{${pal.green}-fg}✓{/}` : `{${pal.peach}-fg}○{/}`;
}

type ToolsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly customTools?: CustomToolManager;
  readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
};

type ToolsViewMode = 'list' | 'code_viewer' | 'secret_assignment';

export function createToolsView(options: ToolsViewOptions): ScreenView {
  const { screen, store, secrets, customTools, builtinTools } = options;

  // Main container
  const container = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    bottom: 0,
    hidden: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // Section tracking
  const sections = ['custom', 'builtin', 'skills'] as const;
  let currentSectionIndex = 0;
  let mode: ToolsViewMode = 'list';

  // Mutable state for code viewer and secret assignment
  let viewingCodeItem: { type: 'custom' | 'skill'; name: string; code: string } | null = null;
  let assigningSecretsItem: { type: 'custom' | 'skill'; name: string } | null = null;
  let assigningSecretsCheckboxes: Widgets.CheckboxListElement | null = null;

  // Store skill docs for type-safe access (C2 fix)
  let skillDocs: Array<{ rkey: string; name: string; content: string; grant?: GrantRow }> = [];

  // Section header showing current section and navigation hint
  const sectionHeader = blessed.box({
    parent: container,
    top: 0,
    height: 1,
    left: 0,
    width: '100%',
    content: '{bold}Custom Tools (1/3){/bold}',
    tags: true,
    style: {
      bg: palette.base,
      fg: palette.text,
    },
  });

  // SelectableList for custom tools
  const customList = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Custom Tools',
  });

  // SelectableList for built-in tools
  const builtinList = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Built-in Tools',
  });

  // SelectableList for skills
  const skillsList = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Skills',
  });

  // ScrollableViewer overlay for code display
  const codeViewer = createScrollableViewer({
    parent: container,
    hidden: true,
  });

  // Status bar
  const statusBar = createStatusBar({ parent: container });

  // Helper: refresh all lists
  function refreshLists(): void {
    // Refresh custom tools
    const customTools_ = customTools?.listTools() ?? [];
    const customItems = customTools_.length === 0
      ? ['{dim}No custom tools{/}']
      : customTools_.map((tool) => {
          const status = formatCustomToolStatus(tool.approved, palette);
          const desc = tool.description ? ` — ${tool.description}` : '';
          return `${status} ${tool.name}${desc}`;
        });
    customList.setItems(customItems);

    // Refresh built-in tools
    const builtinItems = (builtinTools ?? []).map((tool) => {
      const desc = tool.description ? ` — ${tool.description}` : '';
      return `${tool.name}${desc}`;
    });
    builtinList.setItems(builtinItems);

    // Refresh skills
    const result = store.docList(500);
    const skillItems: string[] = [];
    skillDocs = [];

    for (const doc of result.documents) {
      if (!doc.rkey.startsWith('skill:')) continue;
      const name = doc.rkey.slice('skill:'.length);
      const grant = store.getGrant(doc.rkey);
      const icon = formatGrantIcon(grant?.status, palette);
      const description = parseDescription(doc.content);
      const desc = description ? ` — ${description}` : '';
      skillItems.push(`${icon} ${name}${desc}`);
      skillDocs.push({ rkey: doc.rkey, name, content: doc.content, grant });
    }

    if (skillItems.length === 0) {
      skillsList.setItems(['{dim}No skills{/}']);
    } else {
      skillsList.setItems(skillItems);
    }
  }

  // Helper: update section header
  function updateSectionHeader(): void {
    const sectionNames = ['Custom Tools', 'Built-in Tools', 'Skills'];
    const sectionName = sectionNames[currentSectionIndex];
    const count = currentSectionIndex + 1;
    sectionHeader.setContent(`{bold}◀ ${sectionName} (${count}/3) ▶{/bold}`);
    screen.render();
  }

  // Helper: show code viewer
  function showCodeViewer(item: { type: 'custom' | 'skill'; name: string; code: string }): void {
    viewingCodeItem = item;
    mode = 'code_viewer';
    codeViewer.element.show();
    const highlighted = highlightCode(item.code, 'typescript');
    codeViewer.setContent(highlighted);
    codeViewer.focus();
    updateStatusBar();
    screen.render();
  }

  // Helper: hide code viewer
  function hideCodeViewer(): void {
    viewingCodeItem = null;
    mode = 'list';
    codeViewer.element.hide();
    getCurrentList().focus();
    updateStatusBar();
    screen.render();
  }

  // Helper: get current list based on section
  function getCurrentList() {
    if (currentSectionIndex === 0) return customList;
    if (currentSectionIndex === 1) return builtinList;
    return skillsList;
  }

  // Helper: update status bar based on mode
  function updateStatusBar(): void {
    if (mode === 'code_viewer') {
      statusBar.setText('PgUp/PgDn:scroll  g/G:top/bottom  Esc:close');
    } else if (mode === 'secret_assignment') {
      statusBar.setText('Space:toggle  Esc:save & close');
    } else {
      const hints =
        currentSectionIndex === 1
          ? '◀▶:section  Esc:back'
          : '◀▶:section  v:view  s:secrets  Esc:back';
      if (currentSectionIndex === 0) {
        // Custom tools
        statusBar.setText(hints + '  a:approve  r:revoke  d:delete');
      } else if (currentSectionIndex === 2) {
        // Skills
        statusBar.setText(hints + '  g:grant  r:revoke  d:delete');
      } else {
        statusBar.setText(hints);
      }
    }
  }

  // Handle Left/Right arrows to cycle sections
  container.key(['left'], () => {
    if (mode !== 'list') return;
    currentSectionIndex = (currentSectionIndex - 1 + sections.length) % sections.length;
    updateVisibleList();
    getCurrentList().focus();
    updateSectionHeader();
    updateStatusBar();
  });

  container.key(['right'], () => {
    if (mode !== 'list') return;
    currentSectionIndex = (currentSectionIndex + 1) % sections.length;
    updateVisibleList();
    getCurrentList().focus();
    updateSectionHeader();
    updateStatusBar();
  });

  // Handle code viewer keys
  container.key(['pageup'], () => {
    if (mode === 'code_viewer' && codeViewer) {
      codeViewer.scroll(-10);
    }
  });

  container.key(['pagedown'], () => {
    if (mode === 'code_viewer' && codeViewer) {
      codeViewer.scroll(10);
    }
  });

  container.key(['g'], () => {
    if (mode === 'code_viewer') {
      codeViewer.scrollToTop();
    } else if (mode === 'list' && currentSectionIndex === 2) {
      const list = getCurrentList();
      const index = list.getSelectedIndex();
      const doc = skillDocs[index];
      if (doc) {
        store.updateGrantStatus(doc.rkey, 'granted');
        refreshLists();
      }
    }
  });

  container.key(['S-g'], () => {
    if (mode === 'code_viewer') {
      codeViewer.scrollToBottom();
    }
  });

  // Handle Escape in any mode
  container.key(['escape'], () => {
    if (mode === 'code_viewer') {
      hideCodeViewer();
    } else if (mode === 'secret_assignment') {
      mode = 'list';
      assigningSecretsItem = null;
      if (assigningSecretsCheckboxes) {
        assigningSecretsCheckboxes.destroy();
        assigningSecretsCheckboxes = null;
      }
      getCurrentList().focus();
      updateStatusBar();
      screen.render();
    }
  });

  // Handle 'v' to view code (custom/skills only)
  container.key(['v'], () => {
    if (mode !== 'list' || currentSectionIndex === 1) return;
    const list = getCurrentList();
    const index = list.getSelectedIndex();

    if (currentSectionIndex === 0) {
      // Custom tools
      const tools = customTools?.listTools() ?? [];
      const tool = tools[index];
      if (tool) {
        showCodeViewer({ type: 'custom', name: tool.name, code: tool.code });
      }
    } else {
      // Skills
      const doc = skillDocs[index];
      if (doc) {
        showCodeViewer({ type: 'skill', name: doc.name, code: doc.content });
      }
    }
  });

  // Handle 's' to assign secrets (custom/skills only)
  container.key(['s'], () => {
    if (mode !== 'list' || currentSectionIndex === 1) return;
    const list = getCurrentList();
    const index = list.getSelectedIndex();

    const secretNames = secrets?.listKeys() ?? [];
    const grantList = store.listGrants();

    let assigningName = '';
    let assigningType: 'custom' | 'skill' = 'custom';
    let currentSecrets: string[] = [];

    if (currentSectionIndex === 0) {
      // Custom tools
      const tools = customTools?.listTools() ?? [];
      const tool = tools[index];
      if (tool) {
        assigningName = tool.name;
        assigningType = 'custom';
        currentSecrets = Array.from(tool.secrets);
      }
    } else {
      // Skills
      const doc = skillDocs[index];
      if (doc) {
        assigningName = doc.name;
        assigningType = 'skill';
        const grant = store.getGrant(doc.rkey);
        currentSecrets = Array.from(grant?.secrets ?? []);
      }
    }

    if (!assigningName) return;

    assigningSecretsItem = { type: assigningType, name: assigningName };
    mode = 'secret_assignment';

    // Create checkbox list for secrets
    const items = secretNames.map((s) => ({ text: s, checked: currentSecrets.includes(s) }));
    assigningSecretsCheckboxes = blessed.checkbox({
      parent: container,
      top: 1,
      left: 0,
      width: '100%',
      height: 'shrink',
      label: `Assign secrets to ${assigningName}`,
      keys: true,
      mouse: true,
      items,
      style: {
        selected: blessedStyles.selected,
        item: blessedStyles.text,
      },
    });

    assigningSecretsCheckboxes.focus();
    updateStatusBar();
    screen.render();
  });

  // Handle 'a' to approve custom tools
  container.key(['a'], () => {
    if (mode !== 'list' || currentSectionIndex !== 0) return;
    const list = getCurrentList();
    const index = list.getSelectedIndex();
    const tools = customTools?.listTools() ?? [];
    const tool = tools[index];
    if (tool) {
      customTools?.approveTool(tool.name);
      refreshLists();
    }
  });

  // Handle 'r' to revoke approval
  container.key(['r'], () => {
    if (mode !== 'list' || (currentSectionIndex !== 0 && currentSectionIndex !== 2)) return;
    const list = getCurrentList();
    const index = list.getSelectedIndex();

    if (currentSectionIndex === 0) {
      // Custom tools
      const tools = customTools?.listTools() ?? [];
      const tool = tools[index];
      if (tool) {
        customTools?.revokeTool(tool.name);
        refreshLists();
      }
    } else {
      // Skills
      const doc = skillDocs[index];
      if (doc) {
        store.updateGrantStatus(doc.rkey, 'revoked');
        refreshLists();
      }
    }
  });

  // Handle 'd' to delete (custom tools and skills)
  container.key(['d'], () => {
    if (mode !== 'list' || (currentSectionIndex !== 0 && currentSectionIndex !== 2)) return;
    const list = getCurrentList();
    const index = list.getSelectedIndex();

    if (currentSectionIndex === 0) {
      // Custom tools - just delete by removing the document
      const tools = customTools?.listTools() ?? [];
      const tool = tools[index];
      if (tool) {
        store.docDelete(`customtool:${tool.name}`);
        refreshLists();
      }
    } else {
      // Skills
      const doc = skillDocs[index];
      if (doc) {
        store.docDelete(doc.rkey);
        store.deleteGrant(doc.rkey);
        refreshLists();
      }
    }
  });

  // Handle Space in secret assignment mode to toggle selection
  container.key(['space'], () => {
    if (mode === 'secret_assignment' && assigningSecretsCheckboxes) {
      const index = (assigningSecretsCheckboxes as any).selected ?? 0;
      const items = (assigningSecretsCheckboxes as any).items || [];
      if (items[index]) {
        items[index].checked = !items[index].checked;
        assigningSecretsCheckboxes.render();

        // Update the actual secrets assignment
        const selectedSecrets = items.filter((item: any) => item.checked).map((item: any) => item.text);

        if (assigningSecretsItem?.type === 'custom') {
          customTools?.updateSecrets(assigningSecretsItem.name, selectedSecrets);
        } else if (assigningSecretsItem?.type === 'skill') {
          const skillDoc = skillDocs.find((d) => d.name === assigningSecretsItem?.name);
          if (skillDoc) {
            store.updateGrantSecrets(skillDoc.rkey, selectedSecrets);
          }
        }
      }
    }
  });

  // Initial setup
  refreshLists();
  updateSectionHeader();
  updateStatusBar();

  // Hide lists except the first one
  builtinList.element.hide();
  skillsList.element.hide();

  // Helper: show/hide lists when switching sections
  function updateVisibleList(): void {
    const lists = [customList, builtinList, skillsList];
    for (let i = 0; i < lists.length; i++) {
      if (i === currentSectionIndex) {
        lists[i].element.show();
      } else {
        lists[i].element.hide();
      }
    }
  }

  return {
    name: 'Tools',
    container,
    get isCapturingInput(): boolean {
      return mode !== 'list';
    },
    show(): void {
      container.show();
      screen.render();
    },
    hide(): void {
      container.hide();
      screen.render();
    },
    focus(): void {
      getCurrentList().focus();
    },
    destroy(): void {
      container.destroy();
    },
  };
}
