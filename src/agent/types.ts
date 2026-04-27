// pattern: Functional Core

import type { Message, ModelProvider, ToolDefinition, UsageStats } from '../model/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { VectorStore } from '../search/vector-store.ts';
import type { TaskStore } from '../scheduler/types.ts';
import type { Store } from '../store/store.ts';
import type { SecretManager } from '../secrets/manager.ts';
import type { CustomToolManager } from '../tools/custom-tool-manager.ts';

export type AgentConfig = {
  readonly model: string;
  readonly maxTokens: number;
  readonly maxToolRounds: number;
  readonly contextBudget: number;
  readonly contextLimit: number;
  readonly modelTimeout: number;
  readonly temperature?: number;
  readonly timezone: string;
};

export type ChatStats = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextEstimate: number;  // estimated context size in tokens
  readonly contextLimit: number;     // configured context budget
  readonly rounds: number;           // number of model calls
  readonly durationMs: number;       // wall-clock time for entire chat()
};

export type ChatResult = {
  readonly text: string;
  readonly stats: ChatStats;
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
  readonly customTools?: CustomToolManager;
  readonly systemPromptProvider?: (toolDocs: string) => Promise<string>;
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

export type ChatOptions = {
  readonly context?: ChatContext;
  readonly images?: ChatImage[];
  readonly conversationOverride?: Array<Message>;
};

export type Agent = {
  chat(userMessage: string, options?: ChatOptions): Promise<ChatResult>;
  reset(): void;
};
