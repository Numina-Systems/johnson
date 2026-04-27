// pattern: Functional Core — summarize tool registration

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import { str, optStr } from './helpers.ts';

const LENGTH_GUIDANCE: Record<string, string> = {
  short: 'Respond in 2-3 sentences.',
  medium: 'Respond in 1-2 paragraphs.',
  long: 'Respond in up to 4 paragraphs.',
};

const SUMMARIZE_SYSTEM =
  'You are a precise summarization assistant. Preserve key facts, names, and numbers. Do not add information not present in the source text.';

const MAX_INPUT_CHARS = 100_000;

export function registerSummarizeTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  registry.register(
    'summarize',
    {
      name: 'summarize',
      description:
        'Summarize text using a sub-agent LLM. Returns a concise summary preserving key facts.\n\n' +
        'Use for long documents, articles, or any content that needs condensing. Optionally provide focus instructions to guide what the summary emphasizes.',
      input_schema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Content to summarize (truncated at 100k chars)',
          },
          instructions: {
            type: 'string',
            description: 'Optional focus guidance (e.g., "focus on technical claims")',
          },
          max_length: {
            type: 'string',
            enum: ['short', 'medium', 'long'],
            description:
              'Summary length: "short" (2-3 sentences), "medium" (1-2 paragraphs), "long" (up to 4 paragraphs). Default: "medium".',
          },
        },
        required: ['text'],
      },
    },
    async (params) => {
      if (!deps.subAgent) {
        throw new Error('Sub-agent LLM not configured. Add [sub_model] to config.toml.');
      }

      const text = str(params, 'text').slice(0, MAX_INPUT_CHARS);
      const instructions = optStr(params, 'instructions');
      const maxLength = optStr(params, 'max_length', 'medium');

      let prompt = `Summarize the following text. ${LENGTH_GUIDANCE[maxLength] ?? LENGTH_GUIDANCE.medium}`;
      if (instructions) {
        prompt += `\n\nFocus: ${instructions}`;
      }
      prompt += `\n\n---\n\n${text}`;

      const result = await deps.subAgent.complete(prompt, SUMMARIZE_SYSTEM);
      return { summary: result };
    },
    'both',
  );
}
