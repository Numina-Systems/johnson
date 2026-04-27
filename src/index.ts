// pattern: Imperative Shell

/**
 * Entry point for constellation-lite.
 * Wires up config, model provider, runtime, store, secrets, scheduler, and agent,
 * then launches the selected interface(s): TUI, Discord, or both.
 */

import { resolve } from 'path';
import { loadConfig } from './config/loader.ts';
import { createModelProvider } from './model/index.ts';
import { createSubAgent, wrapMainModel } from './model/sub-agent.ts';
import type { SubAgentLLM } from './model/sub-agent.ts';
import { createDenoExecutor } from './runtime/executor.ts';
import { createAgent } from './agent/agent.ts';
import { createEmbeddingProvider } from './embedding/index.ts';
import { createScheduler } from './scheduler/index.ts';
import { createSecretManager } from './secrets/index.ts';
import { createStore } from './store/store.ts';
import { reindexEmbeddings } from './search/hybrid.ts';
import { startTUI } from './tui/index.ts';
import { createDiscordBot } from './discord/index.ts';
import type { Agent, AgentDependencies } from './agent/types.ts';
import type { EmbeddingProvider } from './embedding/types.ts';
import type { TaskStore } from './scheduler/types.ts';
import { log } from './util/log.ts';

const CONFIG_PATH = resolve(import.meta.dir, '..', 'config.toml');
const PERSONA_PATH = resolve(import.meta.dir, '..', 'persona.md');
const DATA_DIR = resolve(import.meta.dir, '..', 'data');
const TASKS_PATH = resolve(DATA_DIR, 'tasks.json');
const SECRETS_PATH = resolve(DATA_DIR, 'secrets.json');

async function main(): Promise<void> {
  // Load config
  const config = loadConfig(CONFIG_PATH);

  // Set process-wide timezone from config — affects Date formatting in the host process
  process.env['TZ'] = config.agent.timezone;

  // Wire up shared dependencies
  const model = createModelProvider(config.model);
  const runtime = createDenoExecutor({ ...config.runtime, dataDir: DATA_DIR });

  // SQLite store — single source of truth for notes, embeddings, sessions, tasks, skills
  const store = createStore(resolve(DATA_DIR, 'constellation.db'));

  // Secret manager — flat JSON file for secret values (never in the DB)
  const secrets = createSecretManager(SECRETS_PATH);

  // Sub-agent LLM — cheap model for compaction, titles, summarization.
  // Falls back to wrapping the main model if [sub_model] not configured.
  const subAgent: SubAgentLLM = config.subModel
    ? createSubAgent(config.subModel)
    : wrapMainModel(model, config.model.name, config.model.maxTokens);

  // Embedding + vector store (optional — gracefully degrades if Ollama is unavailable)
  let embedding: EmbeddingProvider | undefined;
  if (config.embedding) {
    try {
      embedding = createEmbeddingProvider(config.embedding);
    } catch (err) {
      log(`⚠ Embedding provider init failed, semantic search disabled: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Reindex stale embeddings in background
  if (embedding && store) {
    reindexEmbeddings({ store, embedding }, config.embedding!.model).catch(err => log(`Embedding reindex failed: ${err}`));
  }

  // Ensure directories exist
  const { mkdir } = await import('fs/promises');
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(config.runtime.workingDir, { recursive: true });

  // Discord bot (created early so the scheduler can reference its send function)
  let bot: ReturnType<typeof createDiscordBot> | undefined;
  let sendDiscord: ((channelId: string, message: string) => Promise<void>) | undefined;

  // Shared agent for Discord + scheduler.
  // Persistent session history is passed via conversationOverride on each chat() call.
  // Note: scheduler is wired in below via agentDeps — the agent reads it at tool-call time,
  // not at construction, so the late binding is safe.
  const agentDeps: AgentDependencies = {
    model,
    runtime,
    config: {
      model: config.model.name,
      maxTokens: config.model.maxTokens,
      maxToolRounds: config.agent.maxToolRounds,
      contextBudget: config.agent.contextBudget,
      contextLimit: config.agent.contextLimit,
      modelTimeout: config.agent.modelTimeout,
      timezone: config.agent.timezone,
    },
    personaPath: PERSONA_PATH,
    embedding,
    get scheduler() { return scheduler; },
    store,
    secrets,
    subAgent,
  };
  const sharedAgent = createAgent(agentDeps);

  // Scheduler — always created, Discord delivery wired in after bot starts
  const scheduler: TaskStore = createScheduler({
    agent: sharedAgent,
    persistPath: TASKS_PATH,
    get sendDiscord() { return sendDiscord; },
    runtime,       // for trigger execution
    store,         // for skill lookup + persistent sessions
    secrets,       // for trigger secret resolution
  });

  const modelName = `${config.model.provider}/${config.model.name}`;
  const mode = config.interface;

  // Launch interface(s)
  if (mode === 'tui' || mode === 'both') {
    // TUI gets its own agent with in-memory history (no conversationOverride needed)
    const tuiAgent = createAgent({ ...agentDeps, scheduler });
    startTUI({ agent: tuiAgent, modelName, store, secrets });
  }

  if (mode === 'discord' || mode === 'both') {
    if (!config.discord) {
      log('⚠ Discord interface requested but no [discord] config or DISCORD_BOT_TOKEN found.');
      if (mode === 'discord') process.exit(1);
    } else {
      bot = createDiscordBot(config.discord, sharedAgent, store);
      await bot.start();

      // Wire up Discord delivery for the scheduler
      sendDiscord = bot.sendToChannel;
    }
  }

  // Start the scheduler (rehydrates persisted tasks)
  scheduler.start();

  // Graceful shutdown
  const shutdown = () => {
    log('Shutting down...');
    scheduler.stop();
    store.close();
    if (bot) bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
