// pattern: Functional Core — TUI shared types

import type { Agent } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';
import type { TaskStore } from '../scheduler/types.ts';

// Screen identifiers for stack-based navigation.
export type Screen = 'sessions' | 'chat' | 'tools' | 'secrets' | 'schedules' | 'prompt';

// All TUI dependencies. Individual screens destructure what they need.
export type TuiDependencies = {
  readonly agent: Agent;
  readonly modelName: string;
  readonly store: Store;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly customTools?: {
    listTools(): Array<{ name: string; description: string; approved: boolean }>;
    approveTool(name: string): void;
    revokeTool(name: string): void;
  };
  readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;
  readonly builtinTools?: ReadonlyArray<{ name: string; description: string }>;
};

// Navigation actions passed to screens as callbacks.
export type NavigationActions = {
  readonly push: (screen: Screen) => void;
  readonly pop: () => void;
};
