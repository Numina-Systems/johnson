// pattern: Functional Core — notify tool registration

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === 'string' ? val : undefined;
}

export function registerNotifyTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  // TODO(GH03): Add mode: 'both' when multi-tool architecture lands
  registry.register(
    'notify_discord',
    {
      name: 'notify_discord',
      description:
        'Send a message to Discord via webhook. Requires DISCORD_WEBHOOK_URL secret. ' +
        'If title is provided, sends as a rich embed; otherwise sends as a plain message. ' +
        'Content is truncated to 2000 characters.',
      input_schema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Message body (truncated to 2000 chars)',
          },
          title: {
            type: 'string',
            description: 'Optional title — if provided, sends as a Discord embed instead of plain message',
          },
        },
        required: ['content'],
      },
    },
    async (params) => {
      const webhookUrl = deps.secrets?.get('DISCORD_WEBHOOK_URL');
      if (!webhookUrl) {
        return 'Error: DISCORD_WEBHOOK_URL secret not configured. Add it via the TUI secrets screen.';
      }

      const content = str(params, 'content').slice(0, 2000);
      const title = optStr(params, 'title');

      const body = title
        ? { embeds: [{ title, description: content }] }
        : { content };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return `Error: Discord webhook returned ${response.status}: ${await response.text()}`;
      }

      return 'Notification sent.';
    },
  );
}
