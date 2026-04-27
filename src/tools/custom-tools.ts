// pattern: Functional Core — custom tool agent-facing tool definitions

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { CustomToolManager } from './custom-tool-manager.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

export type CustomToolDeps = {
  readonly customTools: CustomToolManager;
  readonly runtime: CodeRuntime;
  readonly secrets?: SecretManager;
};

const TOOL_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function registerCustomTools(
  registry: ToolRegistry,
  deps: Readonly<CustomToolDeps>,
): void {

  registry.register(
    'create_custom_tool',
    {
      name: 'create_custom_tool',
      description:
        'Create or update a custom tool. Custom tools are TypeScript code that runs in the Deno sandbox when called via call_custom_tool. New tools start unapproved and must be approved via /review before they can be executed. Changing code or parameters auto-revokes approval.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name (lowercase, alphanumeric + hyphens, starts with letter)' },
          description: { type: 'string', description: 'What the tool does' },
          parameters: { type: 'object', description: 'JSON Schema for the tool parameters. Available as __params in the tool code.' },
          code: { type: 'string', description: 'TypeScript code to execute. Has access to __params (the caller-provided params) and output()/debug() helpers.' },
          secrets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Secret names to inject as env vars when running (e.g. ["OPENAI_API_KEY"])',
          },
        },
        required: ['name', 'description', 'parameters', 'code'],
      },
    },
    async (input) => {
      const name = input['name'];
      const description = input['description'];
      const parameters = input['parameters'];
      const code = input['code'];
      const secrets = input['secrets'];

      if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
        throw new Error(`Invalid tool name: "${name}". Must match /^[a-z][a-z0-9-]*$/.`);
      }
      if (typeof description !== 'string' || !description.trim()) {
        throw new Error('Missing required param: description');
      }
      if (typeof parameters !== 'object' || parameters === null) {
        throw new Error('Missing required param: parameters (must be a JSON Schema object)');
      }
      if (typeof code !== 'string' || !code.trim()) {
        throw new Error('Missing required param: code');
      }

      const secretsList: string[] = Array.isArray(secrets)
        ? secrets.filter((s): s is string => typeof s === 'string')
        : [];

      const existed = deps.customTools.getTool(name);
      const result = deps.customTools.saveTool({
        name,
        description,
        parameters: parameters as Record<string, unknown>,
        code,
        secrets: secretsList,
      });

      if (result.approved) {
        return `Tool "${name}" updated (code unchanged, still approved).`;
      }
      if (existed) {
        return `Tool "${name}" updated. Code changed — approval revoked, needs re-approval via /review.`;
      }
      return `Tool "${name}" created. Pending approval — use /review in the TUI to approve.`;
    },
    'sandbox',
  );

  registry.register(
    'list_custom_tools',
    {
      name: 'list_custom_tools',
      description: 'List all custom tools with their approval status.',
      input_schema: { type: 'object', properties: {} },
    },
    async () => {
      const tools = deps.customTools.listTools();
      if (tools.length === 0) return '(no custom tools)';
      return tools
        .map(t => `- **${t.name}** ${t.approved ? '(approved)' : '(pending approval)'} — ${t.description}`)
        .join('\n');
    },
    'sandbox',
  );

  registry.register(
    'call_custom_tool',
    {
      name: 'call_custom_tool',
      description:
        'Execute an approved custom tool by name. The tool runs in a Deno sandbox with its declared secrets injected as environment variables. Pass params matching the tool\'s JSON Schema — available as __params in the tool code.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the custom tool to call' },
          params: { type: 'object', description: 'Parameters to pass (available as __params in tool code)' },
        },
        required: ['name'],
      },
    },
    async (input) => {
      const name = input['name'];
      if (typeof name !== 'string') throw new Error('Missing required param: name');

      const params = input['params'] ?? {};

      const tool = deps.customTools.getTool(name);
      if (!tool) throw new Error(`Custom tool not found: "${name}"`);
      if (!tool.approved) {
        throw new Error(`Custom tool "${name}" is not approved. Use /review in the TUI to approve it.`);
      }

      const env = deps.secrets ? deps.secrets.resolve(tool.secrets) : {};

      const fullCode = `const __params = ${JSON.stringify(params)};\n${tool.code}`;

      const result = await deps.runtime.execute(
        fullCode,
        Object.keys(env).length > 0 ? env : undefined,
      );

      if (!result.success) {
        throw new Error(`${result.error ?? 'unknown error'}\n${result.output}`);
      }

      return result.output || '(no output)';
    },
    'sandbox',
  );
}
