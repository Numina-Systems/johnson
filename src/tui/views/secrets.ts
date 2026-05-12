// pattern: Imperative Shell — secrets view with add, delete, and skill assignment

import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import type { Store } from '../../store/store.ts';
import type { SecretManager } from '../../secrets/manager.ts';
import type { CustomToolManager } from '../../tools/custom-tool-manager.ts';
import type { ScreenView } from '../types.ts';
import { createSelectableList } from '../widgets/selectable-list.ts';
import { createStatusBar } from '../widgets/status-bar.ts';
import { palette, blessedStyles } from '../theme.ts';

// pattern: Functional Core — format secret usage information
export function formatSecretUsage(name: string, usageItems: ReadonlyArray<string>): string {
  if (usageItems.length === 0) {
    return name;
  }
  return `${name}  used by: ${usageItems.join(', ')}`;
}

type SecretsViewOptions = {
  readonly screen: Widgets.Screen;
  readonly secrets?: SecretManager;
  readonly store: Store;
  readonly customTools?: CustomToolManager;
};

type SecretsViewMode = 'list' | 'add_name' | 'add_value' | 'confirm_delete' | 'edit_skills';

export function createSecretsView(options: SecretsViewOptions): ScreenView {
  const { screen, secrets, store, customTools } = options;

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

  // Mode tracking
  let mode: SecretsViewMode = 'list';
  let pendingAddName = '';
  let pendingAddValue = '';
  let deletingSecretName = '';
  let assigningSecretName = '';

  // List widget
  const list = createSelectableList({
    parent: container,
    top: 1,
    left: 0,
    width: '100%',
    height: 'shrink',
    label: 'Secrets',
  });

  // Input textbox for add_name and add_value modes
  let inputBox: Widgets.TextboxElement | null = null;

  // Confirmation dialog
  let confirmDialog: Widgets.BoxElement | null = null;

  // Skills/tools checkbox list for edit_skills mode
  // blessed.checkbox creates a widget not in @types/blessed, so we use any
  let skillsCheckbox: any = null;

  // Status bar
  const statusBar = createStatusBar({ parent: container });

  // Helper: find what uses a secret (skills and custom tools)
  function findSecretUsage(secretName: string): string[] {
    const usage: string[] = [];

    // Check grants for this secret
    const grants = store.listGrants();
    for (const grant of grants) {
      if (grant.secrets.includes(secretName)) {
        // Extract friendly skill name from the rkey (remove 'skill:' prefix) (I3 fix)
        usage.push(grant.skillName.replace('skill:', ''));
      }
    }

    // Check custom tools for this secret
    const tools = customTools?.listTools() ?? [];
    for (const tool of tools) {
      if (tool.secrets.includes(secretName)) {
        usage.push(tool.name);
      }
    }

    return usage;
  }

  // Helper: refresh the list
  function refreshList(): void {
    const secretNames = secrets?.listKeys() ?? [];
    if (secretNames.length === 0) {
      list.setItems(['{dim}No secrets. Press a to add one.{/}']);
    } else {
      const items = secretNames.map((name) => {
        const usage = findSecretUsage(name);
        return formatSecretUsage(name, usage);
      });
      list.setItems(items);
    }
  }

  // Helper: update status bar based on mode
  function updateStatusBar(): void {
    if (mode === 'list') {
      statusBar.setText('a:add  d:delete  s:assign tools  Esc:back');
    } else if (mode === 'add_name') {
      statusBar.setText('Enter:confirm  Esc:cancel');
    } else if (mode === 'add_value') {
      statusBar.setText('Enter:save  Esc:cancel');
    } else if (mode === 'confirm_delete') {
      statusBar.setText('y:confirm  n:cancel');
    } else if (mode === 'edit_skills') {
      statusBar.setText('Space:toggle  Esc:save & close');
    }
  }

  // Helper: show add_name input
  function showAddNameInput(): void {
    mode = 'add_name';
    pendingAddName = '';
    pendingAddValue = '';

    if (inputBox) inputBox.destroy();
    inputBox = blessed.textbox({
      parent: container,
      top: '50%',
      left: '10%',
      width: '80%',
      height: 3,
      name: 'add-name-input',
      border: 'line',
      label: 'Secret Name',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        border: blessedStyles.border,
        text: blessedStyles.text,
        focus: blessedStyles.selected,
      },
    });

    inputBox.key(['enter'], () => {
      const name = (inputBox as any).getValue?.();
      if (name && name.trim()) {
        pendingAddName = name.trim();
        showAddValueInput();
      }
    });

    inputBox.key(['escape'], () => {
      if (inputBox) inputBox.destroy();
      inputBox = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    });

    inputBox.focus();
    updateStatusBar();
    screen.render();
  }

  // Helper: show add_value input
  function showAddValueInput(): void {
    mode = 'add_value';
    if (inputBox) inputBox.destroy();

    inputBox = blessed.textbox({
      parent: container,
      top: '50%',
      left: '10%',
      width: '80%',
      height: 3,
      name: 'add-value-input',
      border: 'line',
      label: `Value for ${pendingAddName}`,
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      censor: true,
      style: {
        border: blessedStyles.border,
        text: blessedStyles.text,
        focus: blessedStyles.selected,
      },
    });

    inputBox.key(['enter'], async () => {
      const value = (inputBox as any).getValue?.();
      if (value) {
        pendingAddValue = value;
        await secrets?.set(pendingAddName, pendingAddValue);
        if (inputBox) inputBox.destroy();
        inputBox = null;
        mode = 'list';
        refreshList();
        list.focus();
        updateStatusBar();
        screen.render();
      }
    });

    inputBox.key(['escape'], () => {
      if (inputBox) inputBox.destroy();
      inputBox = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    });

    inputBox.focus();
    updateStatusBar();
    screen.render();
  }

  // Helper: show delete confirmation
  function showDeleteConfirmation(secretName: string): void {
    mode = 'confirm_delete';
    deletingSecretName = secretName;

    if (confirmDialog) confirmDialog.destroy();
    confirmDialog = blessed.box({
      parent: container,
      top: '50%',
      left: '20%',
      width: '60%',
      height: 5,
      border: 'line',
      content: `Delete secret '${secretName}'? (y/n)`,
      tags: true,
      keys: true,
      style: {
        border: blessedStyles.border,
        text: blessedStyles.text,
      },
    });

    confirmDialog.key(['y'], async () => {
      await secrets?.remove(secretName);
      if (confirmDialog) confirmDialog.destroy();
      confirmDialog = null;
      mode = 'list';
      refreshList();
      list.focus();
      updateStatusBar();
      screen.render();
    });

    confirmDialog.key(['n', 'escape'], () => {
      if (confirmDialog) confirmDialog.destroy();
      confirmDialog = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    });

    confirmDialog.focus();
    updateStatusBar();
    screen.render();
  }

  // Helper: show skills/tools assignment
  function showEditSkillsAssignment(secretName: string): void {
    mode = 'edit_skills';
    assigningSecretName = secretName;

    // Collect all assignable items
    const assignableItems: Array<{ type: 'skill' | 'tool'; rkey: string; name: string }> = [];

    // Add skills
    const grants = store.listGrants();
    for (const grant of grants) {
      assignableItems.push({
        type: 'skill',
        rkey: grant.skillName, // skillName is actually the rkey in grants
        name: grant.skillName.replace('skill:', ''),
      });
    }

    // Add custom tools
    const tools = customTools?.listTools() ?? [];
    for (const tool of tools) {
      assignableItems.push({
        type: 'tool',
        rkey: `customtool:${tool.name}`,
        name: tool.name,
      });
    }

    // Pre-check items that have this secret
    const items = assignableItems.map((item) => {
      let hasSecret = false;
      if (item.type === 'skill') {
        const grant = store.getGrant(item.rkey);
        hasSecret = grant?.secrets.includes(secretName) ?? false;
      } else {
        const tool = customTools?.getTool(item.name);
        hasSecret = tool?.secrets.includes(secretName) ?? false;
      }
      return { text: item.name, checked: hasSecret };
    });

    if (skillsCheckbox) skillsCheckbox.destroy();
    skillsCheckbox = blessed.checkbox({
      parent: container,
      top: 1,
      left: 0,
      width: '100%',
      height: 'shrink',
      label: `Assign ${secretName} to skills/tools`,
      keys: true,
      mouse: true,
      items,
      style: {
        selected: blessedStyles.selected,
        item: blessedStyles.text,
      },
    });

    skillsCheckbox.key(['escape'], () => {
      // Save selections
      const selectedItems = items
        .map((item, idx) => (item.checked ? assignableItems[idx] : null))
        .filter((item): item is (typeof assignableItems)[0] => item !== null);

      // Update secrets for each item
      for (const item of selectedItems) {
        if (item.type === 'skill') {
          const grant = store.getGrant(item.rkey);
          if (grant) {
            const newSecrets = Array.from(grant.secrets);
            if (!newSecrets.includes(secretName)) {
              newSecrets.push(secretName);
            }
            store.updateGrantSecrets(item.rkey, newSecrets);
          }
        } else {
          const tool = customTools?.getTool(item.name);
          if (tool) {
            const newSecrets = Array.from(tool.secrets);
            if (!newSecrets.includes(secretName)) {
              newSecrets.push(secretName);
            }
            customTools?.updateSecrets(item.name, newSecrets);
          }
        }
      }

      // Remove secret from unselected items
      for (const item of assignableItems) {
        const isSelected = selectedItems.some((si) => si.rkey === item.rkey);
        if (!isSelected) {
          if (item.type === 'skill') {
            const grant = store.getGrant(item.rkey);
            if (grant) {
              const newSecrets = grant.secrets.filter((s) => s !== secretName);
              store.updateGrantSecrets(item.rkey, newSecrets);
            }
          } else {
            const tool = customTools?.getTool(item.name);
            if (tool) {
              const newSecrets = tool.secrets.filter((s) => s !== secretName);
              customTools?.updateSecrets(item.name, newSecrets);
            }
          }
        }
      }

      if (skillsCheckbox) skillsCheckbox.destroy();
      skillsCheckbox = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    });

    skillsCheckbox.key(['space'], () => {
      const index = (skillsCheckbox as any).selected ?? 0;
      if (items[index]) {
        items[index].checked = !items[index].checked;
        skillsCheckbox.render();
      }
    });

    skillsCheckbox.focus();
    updateStatusBar();
    screen.render();
  }

  // Handle 'a' to add secret
  container.key(['a'], () => {
    if (mode === 'list') {
      showAddNameInput();
    }
  });

  // Handle 'd' to delete secret
  container.key(['d'], () => {
    if (mode === 'list') {
      const index = list.getSelectedIndex();
      const secretNames = secrets?.listKeys() ?? [];
      const secretName = secretNames[index];
      if (secretName) {
        showDeleteConfirmation(secretName);
      }
    }
  });

  // Handle 's' to assign secret to skills/tools
  container.key(['s'], () => {
    if (mode === 'list') {
      const index = list.getSelectedIndex();
      const secretNames = secrets?.listKeys() ?? [];
      const secretName = secretNames[index];
      if (secretName) {
        showEditSkillsAssignment(secretName);
      }
    }
  });

  // Handle Escape (I4 fix: skip edit_skills mode since skillsCheckbox handler saves it)
  container.key(['escape'], () => {
    if (mode === 'add_name' || mode === 'add_value') {
      if (inputBox) inputBox.destroy();
      inputBox = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    } else if (mode === 'confirm_delete') {
      if (confirmDialog) confirmDialog.destroy();
      confirmDialog = null;
      mode = 'list';
      list.focus();
      updateStatusBar();
      screen.render();
    }
    // edit_skills mode is handled by skillsCheckbox.key(['escape']) which saves
  });

  // Initial setup
  refreshList();
  updateStatusBar();

  return {
    name: 'Secrets',
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
      list.focus();
    },
    destroy(): void {
      if (inputBox) inputBox.destroy();
      if (confirmDialog) confirmDialog.destroy();
      if (skillsCheckbox) skillsCheckbox.destroy();
      container.destroy();
    },
  };
}
