// pattern: Functional Core

import type { Message, ModelProvider, ToolDefinition, UsageStats } from '../model/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { VectorStore } from '../search/vector-store.ts';
import type { TaskStore } from '../scheduler/types.ts';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';

export type AgentConfig = {
  readonly model: string;
  readonly maxTokens: number;
  readonly maxToolRounds: number;
  readonly contextBudget: number;
  readonly contextLimit: number;
  readonly modelTimeout: number;
  readonly temperature?: number;
};

export type AgentDependencies = {
  readonly model: ModelProvider;
  readonly runtime: CodeRuntime;
  readonly config: AgentConfig;
  readonly personaPath: string;
  readonly embedding?: EmbeddingProvider;
  readonly vectorStore?: VectorStore;
  readonly scheduler?: TaskStore;
  readonly store: Store;
  readonly secrets?: SecretManager;
};

export type ConversationTurn = {
  readonly messages: Array<Message>;
  readonly usage: UsageStats;
};

export type ChatContext = {
  readonly channelId?: string;  // Discord channel ID this message came from
};

export type ChatImage = {
  url: string;      // base64 data URI or HTTP URL
  filename?: string;
};

export type Agent = {
  chat(userMessage: string, context?: ChatContext, images?: ChatImage[]): Promise<string>;
  reset(): void;
};
