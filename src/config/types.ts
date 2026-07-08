// pattern: Functional Core

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type ModelConfig = {
  readonly provider: 'anthropic' | 'openai-compat' | 'ollama' | 'lemonade' | 'openrouter';
  readonly name: string;
  readonly maxTokens: number;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly reasoning?: ReasoningEffort;
};

export type SubModelConfig = {
  readonly provider: 'anthropic' | 'openai-compat' | 'openrouter' | 'ollama' | 'lemonade';
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
  readonly contextLimit: number;    // token count that triggers context compaction
  readonly modelTimeout: number;    // ms timeout for LLM calls
  readonly timezone: string;        // IANA timezone (e.g. "America/New_York")
  readonly recallEnabled: boolean;  // enable the IN-PROCESS reflexive recall pipeline (src/recall/index.ts) — unrelated to [recall]/RecallConfig
  readonly recallTokenBudget: number;  // max tokens for recalled context
  readonly devMode: boolean;
};

export type EmbeddingConfig = {
  readonly provider: 'ollama' | 'openai-compat' | 'lemonade';
  readonly model: string;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly dimensions: number;
  readonly contextLength: number;
};

export type DiscordConfig = {
  readonly token: string;
  readonly allowedChannels?: ReadonlyArray<string>;
  readonly allowedUsers?: ReadonlyArray<string>;
  readonly prefix?: string;
};

/**
 * Config for the EXTERNAL recall server (RecallClient) — an optional HTTP
 * service that ingest_file pushes document encodings to.
 *
 * Not to be confused with `[agent] recallEnabled`, which controls the
 * in-process reflexive recall pipeline (src/recall/index.ts) that runs on
 * every chat() call against the local store + embeddings. The two are
 * independent systems that happen to share a name.
 */
export type RecallConfig = {
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
};

export type ArchivistConfig = {
  readonly enabled: boolean;
  readonly daytimeSchedule: string;
  readonly nighttimeSchedule: string;
  readonly dedupThreshold: number;
  readonly crossrefThreshold: number;
  readonly pruneThreshold: number;
  readonly tokenBudget: number;
  readonly maxLogEntries: number;
};

export type InterfaceMode = 'tui' | 'discord' | 'both';

export type AppConfig = {
  readonly model: ModelConfig;
  readonly runtime: RuntimeConfig;
  readonly agent: AgentLoopConfig;
  readonly embedding?: EmbeddingConfig;
  readonly discord?: DiscordConfig;
  readonly interface: InterfaceMode;
  readonly subModel?: SubModelConfig;
  readonly recall?: RecallConfig;
  readonly archivist?: ArchivistConfig;
};
