// pattern: Functional Core — TUI shared types

import type { Widgets } from 'blessed';
import type { Agent } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';
import type { TaskStore } from '../scheduler/types.ts';
import type { CustomToolManager } from '../tools/custom-tool-manager.ts';

// Blessed screen view contract for neo-blessed migration
export type ScreenView = {
  readonly name: string;
  readonly container: Widgets.BoxElement;
  readonly isCapturingInput: boolean;
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
};

// TUI event types for tab-based navigation and messaging
export type TuiEvents = {
  'message:new': { role: 'user' | 'agent' | 'system'; text: string };
  'message:status': { status: string };
  'session:selected': { sessionId: string };
  'session:changed': void;
  'tab:activity': { tab: string };
};

// All TUI dependencies. Individual screens destructure what they need.
export type TuiDependencies = {
  readonly agent: Agent;
  readonly modelName: string;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: CustomToolManager;
  readonly toolDocs?: string;
  readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
  readonly timezone?: string;
};
