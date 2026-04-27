// pattern: Imperative Shell — prompt-based task scheduler with optional triggers
//
// Scheduled tasks store a prompt, not code.
// When a task fires, it spins up a fresh agent, sends the prompt,
// and delivers the agent's response to Discord.
//
// Optional trigger: TypeScript code that runs in the Deno sandbox first.
// If the trigger produces output, the prompt fires with that output as context.
// If the trigger produces nothing (empty stdout), the prompt is skipped.
// Tasks without a trigger fire unconditionally.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Cron } from "croner";
import type { ScheduledTask, TaskRun, TaskState, TaskStore } from "./types.ts";
import type { Agent, ChatContext } from "../agent/types.ts";
import { loadConversation } from "../agent/messages.ts";
import type { CodeRuntime } from "../runtime/types.ts";
import type { Store } from "../store/store.ts";
import type { SecretManager } from "../secrets/manager.ts";
import { log } from "../util/log.ts";

type LiveTask = {
  state: TaskState;
  cron: Cron;
  running: boolean; // prevent overlapping runs
};

type AgentFactory = () => Agent;
type DiscordSender = (channelId: string, message: string) => Promise<void>;

type SchedulerDeps = {
  readonly agent: Agent;
  readonly persistPath: string;
  readonly sendDiscord?: DiscordSender;
  readonly runtime?: CodeRuntime; // needed for triggers
  readonly store?: Store; // needed to look up skill grant status/secrets + persistent sessions
  readonly secrets?: SecretManager; // needed to resolve secret values for triggers
};

/**
 * Parse human-friendly intervals ("6h", "30m", "1d") into cron expressions.
 * Passes through anything that looks like a cron expression already.
 */
function normalizeSchedule(input: string): string {
  const trimmed = input.trim().toLowerCase();

  // Already a cron expression (has spaces = multiple fields)
  if (trimmed.includes(" ")) return trimmed;

  const match = trimmed.match(
    /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|s|sec|secs|seconds?)$/,
  );
  if (!match) return trimmed; // Let croner validate it

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.charAt(0);

  switch (unit) {
    case "s":
      return `*/${value} * * * * *`; // every N seconds
    case "m":
      return `*/${value} * * * *`; // every N minutes
    case "h":
      return `0 */${value} * * *`; // every N hours
    case "d":
      return `0 0 */${value} * *`; // every N days
    default:
      return trimmed;
  }
}

function truncateForDiscord(text: string, maxLen: number = 1900): string {
  if (text.length <= maxLen) return text;
  return (
    text.slice(0, maxLen) + `\n... (truncated, ${text.length} total chars)`
  );
}

export function createScheduler(deps: SchedulerDeps): TaskStore {
  const tasks = new Map<string, LiveTask>();

  /**
   * Resolve granted secrets for a skill → env var map.
   * Looks up the skill document and its grant in the store, checks it's granted,
   * resolves secret values.
   */
  function resolveSecrets(
    skillName: string | undefined,
  ): Record<string, string> | undefined {
    if (!skillName || !deps.store || !deps.secrets) return undefined;
    try {
      const rkey = skillName.startsWith("skill:")
        ? skillName
        : `skill:${skillName}`;
      const doc = deps.store.docGet(rkey);
      if (!doc) {
        log(`[scheduler] Skill "${skillName}" not found in store`);
        return undefined;
      }
      const grant = deps.store.getGrant(rkey);
      if (!grant || grant.status !== "granted") {
        log(
          `[scheduler] Skill "${skillName}" not granted (status: ${grant?.status ?? "no grant"}) — running without secrets`,
        );
        return undefined;
      }
      if (grant.secrets.length === 0) return undefined;
      const resolved = deps.secrets.resolve(grant.secrets);
      return Object.keys(resolved).length > 0 ? resolved : undefined;
    } catch (err) {
      log(
        `[scheduler] Failed to resolve secrets for skill "${skillName}": ${err}`,
      );
      return undefined;
    }
  }

  async function runTask(live: LiveTask): Promise<void> {
    // Skip if previous run is still in-flight
    if (live.running) {
      log(
        `[scheduler] Skipping "${live.state.name}" — previous run still in-flight`,
      );
      return;
    }
    live.running = true;

    const startedAt = new Date().toISOString();
    const start = performance.now();

    log(`[scheduler] Firing "${live.state.name}"`);

    let output: string;
    let success: boolean;

    try {
      // Phase 1: Run trigger if present
      let triggerData: string | null = null;

      if (live.state.trigger) {
        if (!deps.runtime) {
          log(
            `[scheduler] Task "${live.state.name}" has trigger but no runtime — skipping`,
          );
          live.running = false;
          return;
        }

        const env = resolveSecrets(live.state.skill);
        const result = await deps.runtime.execute(live.state.trigger, env);

        if (!result.success) {
          log(
            `[scheduler] Trigger failed for "${live.state.name}": ${result.error}`,
          );
          // Record the failure but don't fire the prompt
          const durationMs = Math.round(performance.now() - start);
          live.state = {
            ...live.state,
            lastRun: {
              taskId: live.state.id,
              startedAt,
              output: `Trigger error: ${result.error}`,
              success: false,
              durationMs,
            },
            runCount: live.state.runCount + 1,
          };
          persist().catch(() => {});
          live.running = false;
          return;
        }

        const trimmed = (result.output ?? "").trim();
        if (!trimmed) {
          // Trigger produced nothing — skip silently
          log(
            `[scheduler] Trigger for "${live.state.name}" returned empty — skipping`,
          );
          if (result.error) {
            log(`[scheduler] Trigger stderr: ${result.error.slice(0, 2000)}`);
          }
          live.running = false;
          return;
        }

        triggerData = trimmed;
      }

      // Phase 2: Fire prompt through agent with persistent session
      const sessionId = `task:${live.state.id}`;
      const context: ChatContext = { channelId: live.state.deliverTo };

      const prompt = triggerData
        ? `Context from trigger:\n${triggerData}\n\n${live.state.prompt}`
        : live.state.prompt;

      // Load run-to-run conversation history for this task
      let history: import("../model/types.ts").Message[] = [];
      if (deps.store) {
        deps.store.ensureSession(sessionId, live.state.name);
        history = loadConversation(deps.store, sessionId);
        deps.store.appendMessage(sessionId, 'user', prompt);
      }

      const result = await deps.agent.chat(prompt, {
        context,
        conversationOverride: history,
      });
      output = result.text;
      success = true;

      // Save agent response for run-to-run memory
      if (deps.store) {
        deps.store.appendMessage(sessionId, 'assistant', output);
      }
    } catch (err) {
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      success = false;
      log(`[scheduler] Task "${live.state.name}" failed: ${output}`);
    }

    const durationMs = Math.round(performance.now() - start);
    const run: TaskRun = {
      taskId: live.state.id,
      startedAt,
      output,
      success,
      durationMs,
    };

    live.state = {
      ...live.state,
      lastRun: run,
      runCount: live.state.runCount + 1,
    };

    log(
      `[scheduler] "${live.state.name}" completed in ${durationMs}ms (${success ? "✅" : "❌"})`,
    );

    // Deliver to Discord
    if (live.state.deliverTo && deps.sendDiscord && output) {
      const header = `📋 **${live.state.name}**`;
      const body = truncateForDiscord(output);
      try {
        await deps.sendDiscord(live.state.deliverTo, `${header}\n${body}`);
      } catch (err) {
        log(`[scheduler] Failed to deliver to Discord: ${err}`);
      }
    }

    persist().catch(() => {});
    live.running = false;
  }

  function scheduleCron(task: TaskState): LiveTask {
    const cronExpr = normalizeSchedule(task.schedule);
    const cron = new Cron(cronExpr, { catch: true });

    const live: LiveTask = { state: task, cron, running: false };

    // Schedule with callback — croner calls this on each tick.
    // Respect the enabled flag (treat undefined as enabled for backward compat).
    if (task.enabled !== false) {
      cron.schedule(() => {
        runTask(live).catch((err) => {
          log(`[scheduler] Unhandled error in task "${live.state.name}": ${err}`);
        });
      });
    } else {
      cron.stop();
    }

    return live;
  }

  async function persist(): Promise<void> {
    const data = Array.from(tasks.values()).map((t) => t.state);
    await mkdir(dirname(deps.persistPath), { recursive: true });
    await writeFile(deps.persistPath, JSON.stringify(data, null, 2));
  }

  async function loadPersisted(): Promise<Array<TaskState>> {
    try {
      const raw = await readFile(deps.persistPath, "utf-8");
      return JSON.parse(raw) as Array<TaskState>;
    } catch {
      return [];
    }
  }

  return {
    schedule(task: ScheduledTask): void {
      const state: TaskState = {
        ...task,
        runCount: 0,
      };

      const live = scheduleCron(state);
      tasks.set(task.id, live);
      persist().catch(() => {});

      log(
        `[scheduler] Scheduled "${task.name}" (${task.schedule}) → ${normalizeSchedule(task.schedule)}`,
      );
    },

    cancel(id: string): boolean {
      const live = tasks.get(id);
      if (!live) return false;

      live.cron.stop();
      tasks.delete(id);
      persist().catch(() => {});

      log(`[scheduler] Cancelled "${live.state.name}"`);
      return true;
    },

    list(): Array<TaskState> {
      return Array.from(tasks.values()).map((t) => t.state);
    },

    get(id: string): TaskState | undefined {
      return tasks.get(id)?.state;
    },

    setEnabled(id: string, enabled: boolean): boolean {
      const live = tasks.get(id);
      if (!live) return false;

      if (enabled && !live.state.enabled) {
        live.state = { ...live.state, enabled: true };
        live.cron = new Cron(normalizeSchedule(live.state.schedule), { catch: true });
        live.cron.schedule(() => {
          runTask(live).catch((err) => {
            log(`[scheduler] Unhandled error in task "${live.state.name}": ${err}`);
          });
        });
        log(`[scheduler] Enabled "${live.state.name}"`);
      } else if (!enabled && live.state.enabled) {
        live.cron.stop();
        live.state = { ...live.state, enabled: false };
        log(`[scheduler] Disabled "${live.state.name}"`);
      }

      persist().catch(() => {});
      return true;
    },

    start(): void {
      // Rehydrate persisted tasks
      loadPersisted()
        .then((saved) => {
          for (const task of saved) {
            if (!tasks.has(task.id)) {
              const live = scheduleCron(task);
              tasks.set(task.id, live);
              log(`[scheduler] Rehydrated "${task.name}" (${task.schedule})`);
            }
          }
        })
        .catch((err) => {
          log(`[scheduler] Failed to load persisted tasks: ${err}`);
        });
    },

    stop(): void {
      for (const live of tasks.values()) {
        live.cron.stop();
      }
      tasks.clear();
    },
  };
}
