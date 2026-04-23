// pattern: Functional Core

export type ModelConfig = {
  readonly provider: 'anthropic' | 'openai-compat' | 'ollama' | 'lemonade';
  readonly name: string;
  readonly maxTokens: number;
  readonly baseUrl?: string;
  readonly apiKey?: string;
};

export type RuntimeConfig = {
  readonly workingDir: string;
  readonly dataDir?: string;  // protected directory — deny read/write in sandbox
  readonly allowedHosts: ReadonlyArray<string>;
  readonly timeoutMs: number;
  readonly maxCodeSize: number;
  readonly maxOutputSize: number;
  readonly unrestricted: boolean;
};

export type AgentLoopConfig = {
  readonly maxToolRounds: number;
  readonly contextBudget: number;
  readonly contextLimit: number;  // token count that triggers context compaction
  readonly modelTimeout: number;  // ms timeout for LLM calls
};

export type EmbeddingConfig = {
  readonly provider: 'ollama';
  readonly model: string;
  readonly endpoint?: string;
  readonly dimensions: number;
};

export type DiscordConfig = {
  readonly token: string;
  readonly allowedChannels?: ReadonlyArray<string>;
  readonly allowedUsers?: ReadonlyArray<string>;
  readonly prefix?: string;
};

export type InterfaceMode = 'tui' | 'discord' | 'both';

export type AppConfig = {
  readonly model: ModelConfig;
  readonly runtime: RuntimeConfig;
  readonly agent: AgentLoopConfig;
  readonly embedding?: EmbeddingConfig;
  readonly discord?: DiscordConfig;
  readonly interface: InterfaceMode;
};
