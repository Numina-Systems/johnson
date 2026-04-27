// pattern: Functional Core — tool handlers registered into the ToolRegistry

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createToolRegistry, type ToolRegistry } from '../runtime/tool-registry.ts';
import { registerCustomTools } from '../tools/custom-tools.ts';
import { registerWebTools } from '../tools/web.ts';
import { registerImageTools } from '../tools/image.ts';
import type { AgentDependencies, ChatContext } from './types.ts';
import type { GrantStatus } from '../store/store.ts';
import { registerNotifyTools } from '../tools/notify.ts';

// ── Helpers ────────────────────────────────────────────────────────────────

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string, fallback: string = ''): string {
  const val = input[key];
  return typeof val === 'string' ? val : fallback;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

// ── Registry factory ──────────────────────────────────────────────────────

export function createAgentTools(deps: Readonly<AgentDependencies>, context: ChatContext): ToolRegistry {
  const registry = createToolRegistry();

  // ── doc_upsert ──────────────────────────────────────────────────────────
  registry.register(
    'doc_upsert',
    {
      name: 'doc_upsert',
      description:
        `Create or update a document by rkey. Documents are the agent's persistent memory.

Conventional rkeys:
- \`self\` — your identity/persona (loaded into system prompt automatically)
- \`operator\` — what you know about the human you work with
- \`skill:<name>\` — reusable TypeScript skill (requires grant approval to run with secrets)
- \`task:<name>\` — task state/progress
- Any other rkey — free-form notes and data

For skill documents, include a \`// Description: ...\` header comment. Saving a skill auto-creates a grant (pending if new, revoked if code changed).`,
      input_schema: {
        type: 'object',
        properties: {
          rkey: { type: 'string', description: 'Document rkey (e.g. "self", "operator", "skill:exa-news-search")' },
          content: { type: 'string', description: 'Document content (markdown, code, etc.)' },
        },
        required: ['rkey', 'content'],
      },
    },
    async (params) => {
      const rkey = str(params, 'rkey');
      const content = str(params, 'content');

      deps.store.docUpsert(rkey, content);

      // Auto-manage grants for skill documents
      let statusMsg = '';
      if (rkey.startsWith('skill:')) {
        const codeHash = hashCode(content);
        const existingGrant = deps.store.getGrant(rkey);
        let status: GrantStatus = 'pending';
        if (existingGrant) {
          if (existingGrant.codeHash === codeHash) {
            status = existingGrant.status as GrantStatus;
          } else {
            status = 'revoked';
          }
        }
        deps.store.saveGrant(rkey, codeHash, status);

        statusMsg = status === 'pending'
          ? ' ⏳ Pending review — use /review in the TUI to grant.'
          : status === 'revoked'
            ? ' 🔴 Code changed — grant revoked, needs re-review.'
            : '';
      }

      // Embed if embedding provider available
      if (deps.embedding) {
        try {
          const emb = await deps.embedding.embed(content);
          deps.store.saveEmbedding(rkey, emb, 'nomic-embed-text');
        } catch { /* non-fatal */ }
      }

      return `Document saved: ${rkey}.${statusMsg}`;
    },
  );

  // ── doc_get ─────────────────────────────────────────────────────────────
  registry.register(
    'doc_get',
    {
      name: 'doc_get',
      description: 'Read a document by rkey. Returns the document content or an error if not found.',
      input_schema: {
        type: 'object',
        properties: {
          rkey: { type: 'string', description: 'Document rkey to read' },
        },
        required: ['rkey'],
      },
    },
    async (params) => {
      const rkey = str(params, 'rkey');
      const doc = deps.store.docGet(rkey);
      if (!doc) throw new Error(`Document not found: ${rkey}`);
      return doc.content;
    },
  );

  // ── doc_list ────────────────────────────────────────────────────────────
  registry.register(
    'doc_list',
    {
      name: 'doc_list',
      description: 'List all documents. Returns rkeys with timestamps. Use cursor for pagination.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max documents to return (default 50)' },
          cursor: { type: 'string', description: 'Pagination cursor from previous call' },
        },
      },
    },
    async (params) => {
      const limitVal = params['limit'];
      const limit = typeof limitVal === 'number' ? limitVal : 50;
      const cursor = typeof params['cursor'] === 'string' ? params['cursor'] : undefined;

      const result = deps.store.docList(limit, cursor);
      if (result.documents.length === 0) return '(no documents)';

      const lines = result.documents.map((d) => `- ${d.rkey} (updated: ${d.updatedAt})`);
      if (result.cursor) lines.push(`\n(more results — cursor: ${result.cursor})`);
      return lines.join('\n');
    },
  );

  // ── doc_search ──────────────────────────────────────────────────────────
  registry.register(
    'doc_search',
    {
      name: 'doc_search',
      description: 'Full-text search across all documents. Returns matching documents ranked by relevance.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    async (params) => {
      const query = str(params, 'query');
      const limitVal = params['limit'];
      const limit = typeof limitVal === 'number' ? limitVal : 10;

      const results = deps.store.docSearch(query, limit);
      if (results.length === 0) return '(no matching documents)';
      return results
        .map(r => `## ${r.rkey} (rank: ${r.rank.toFixed(3)})\n${r.content.slice(0, 500)}${r.content.length > 500 ? '...' : ''}`)
        .join('\n\n---\n\n');
    },
  );

  // ── run_skill ───────────────────────────────────────────────────────────
  registry.register(
    'run_skill',
    {
      name: 'run_skill',
      description: 'Run a previously saved skill by name. The skill must be granted (approved) to run with secrets. Pass arguments as an array of strings — each element stays intact (no whitespace splitting). Available as `__args` in the skill. Use doc_get to read the skill code first if you need to inspect it.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name (e.g. "exa-news-search") — with or without "skill:" prefix' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional arguments array. Each element is preserved as-is (spaces allowed). Available as __args in the skill.',
          },
        },
        required: ['name'],
      },
    },
    async (params) => {
      const name = str(params, 'name');
      const rawArgs = params['args'];
      const args: string[] | null = Array.isArray(rawArgs)
        ? rawArgs.map(a => String(a))
        : typeof rawArgs === 'string'
          ? rawArgs.split(/\s+/)  // backwards compat: still accept a string
          : null;

      const rkey = name.startsWith('skill:') ? name : `skill:${name}`;
      const doc = deps.store.docGet(rkey);
      if (!doc) throw new Error(`Skill not found: ${name}`);

      // Check grant status
      const grant = deps.store.getGrant(rkey);
      if (!grant || grant.status !== 'granted') {
        const reason = grant?.status === 'revoked'
          ? 'Grant revoked — code changed since last review. Needs re-review via /review.'
          : 'Skill pending review. Ask the user to run /review in the TUI to grant access.';
        throw new Error(`🔒 Cannot run "${name}": ${reason}`);
      }

      // Verify code hash matches grant
      const codeHash = hashCode(doc.content);
      if (codeHash !== grant.codeHash) {
        throw new Error(`🔒 Cannot run "${name}": code has changed since grant was issued. Needs re-review via /review.`);
      }

      // Resolve secrets from SecretManager
      let env: Record<string, string> | undefined;
      if (deps.secrets && grant.secrets.length > 0) {
        const resolved = deps.secrets.resolve(grant.secrets);
        if (Object.keys(resolved).length > 0) {
          env = resolved;
        }
      }

      let code = doc.content;
      if (args) {
        code = `const __args = ${JSON.stringify(args)};\n${code}`;
      }

      const result = await deps.runtime.execute(code, env);
      if (!result.success) {
        throw new Error(`${result.error ?? 'unknown error'}\n${result.output}`);
      }
      return result.output || '(no output)';
    },
  );

  // ── schedule_task ───────────────────────────────────────────────────────
  registry.register(
    'schedule_task',
    {
      name: 'schedule_task',
      description: 'Schedule a prompt to run on a recurring schedule. When the task fires, a fresh agent session runs the prompt and delivers the response. Use cron expressions ("0 */6 * * *") or human intervals ("6h", "30m", "1d"). The prompt should be self-contained. Optionally add a trigger — TypeScript code that runs first in the Deno sandbox. If the trigger produces output, the prompt fires with that data as context. If it produces nothing, the prompt is skipped (zero tokens). Tasks without a trigger fire every time.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable task name (e.g. "world-news-update")' },
          prompt: { type: 'string', description: 'The prompt to send to the agent on each run. Be specific — include what to search for, how to format the output, etc.' },
          schedule: { type: 'string', description: 'Cron expression or interval (e.g. "0 */6 * * *", "6h", "30m")' },
          deliver_to: { type: 'string', description: 'Discord channel ID to send output to. Defaults to the current channel.' },
          trigger: { type: 'string', description: 'Optional TypeScript code to run before the prompt. If it produces stdout output, the prompt fires with that data. If empty output, the prompt is skipped. Use for cheap checks (HTTP polls, file watches) to avoid wasting tokens.' },
          skill: { type: 'string', description: 'Skill rkey whose granted secrets are injected as env vars for the trigger code (e.g. "skill:exa-news-search").' },
        },
        required: ['name', 'prompt', 'schedule'],
      },
    },
    async (params) => {
      if (!deps.scheduler) throw new Error('Scheduler unavailable: not initialized.');
      const name = str(params, 'name');
      const prompt = str(params, 'prompt');
      const schedule = str(params, 'schedule');
      const deliverTo = optStr(params, 'deliver_to') || context.channelId || undefined;
      const trigger = optStr(params, 'trigger') || undefined;
      const skill = optStr(params, 'skill') || undefined;
      const id = randomUUID().slice(0, 8);

      deps.scheduler.schedule({ id, name, prompt, schedule, deliverTo, trigger, skill, enabled: true, createdAt: new Date().toISOString() });

      const parts = [`id: ${id}`, `schedule: ${schedule}`];
      if (deliverTo) parts.push(`delivering to channel ${deliverTo}`);
      if (trigger) parts.push('with trigger guard');

      return `✅ Task "${name}" scheduled (${parts.join(', ')})`;
    },
  );

  // ── list_tasks ──────────────────────────────────────────────────────────
  registry.register(
    'list_tasks',
    {
      name: 'list_tasks',
      description: 'List all scheduled tasks with their status, last run info, and run count.',
      input_schema: { type: 'object', properties: {} },
    },
    async () => {
      if (!deps.scheduler) throw new Error('Scheduler unavailable.');
      const tasks = deps.scheduler.list();
      if (tasks.length === 0) return '(no scheduled tasks)';

      return tasks.map((t) => {
        const lastRun = t.lastRun
          ? `last run: ${t.lastRun.startedAt} (${t.lastRun.success ? '✅' : '❌'}, ${t.lastRun.durationMs}ms)`
          : 'never run';
        return `**${t.name}** (id: ${t.id})\n  schedule: ${t.schedule}\n  runs: ${t.runCount} | ${lastRun}${t.deliverTo ? `\n  delivers to: ${t.deliverTo}` : ''}`;
      }).join('\n\n');
    },
  );

  // ── cancel_task ─────────────────────────────────────────────────────────
  registry.register(
    'cancel_task',
    {
      name: 'cancel_task',
      description: 'Cancel a scheduled task by its ID. Use list_tasks first to find the ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to cancel' },
        },
        required: ['id'],
      },
    },
    async (params) => {
      if (!deps.scheduler) throw new Error('Scheduler unavailable.');
      const id = str(params, 'id');
      const cancelled = deps.scheduler.cancel(id);
      if (!cancelled) throw new Error(`No task found with id: ${id}`);
      return `✅ Task ${id} cancelled.`;
    },
  );

  // Web tools (search, fetch, http)
  registerWebTools(registry, deps);

  // Notification tools
  registerNotifyTools(registry, deps);

  // Image tools
  registerImageTools(registry);

  if (deps.customTools) {
    registerCustomTools(registry, {
      customTools: deps.customTools,
      runtime: deps.runtime,
      secrets: deps.secrets,
    });
  }

  return registry;
}
