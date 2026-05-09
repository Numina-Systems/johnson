// pattern: Imperative Shell

/**
 * Email tool implementation with recipient allowlist validation.
 * Provides send_email tool for sandboxed agent execution.
 */

import type { Tool } from '@/tool/types.ts';
import type { SendEmailFn } from './types.ts';

export type EmailToolOptions = {
  readonly sender: SendEmailFn;
  readonly allowedRecipients: ReadonlyArray<string>;
};

export function createEmailTools(
  options: EmailToolOptions,
): Array<Tool> {
  const { sender, allowedRecipients } = options;

  const send_email: Tool = {
    definition: {
      name: 'send_email',
      description: 'Send an email to an allowed recipient',
      parameters: [
        {
          name: 'to',
          type: 'string',
          description: 'Recipient email address',
          required: true,
        },
        {
          name: 'subject',
          type: 'string',
          description: 'Email subject',
          required: true,
        },
        {
          name: 'body',
          type: 'string',
          description: 'Email body',
          required: true,
        },
        {
          name: 'format',
          type: 'string',
          description: 'Body format: "text" or "html"',
          required: false,
          enum_values: ['text', 'html'],
        },
      ],
    },
    handler: async (params) => {
      const to = params['to'] as string;
      const subject = params['subject'] as string;
      const body = params['body'] as string;
      const format = (params['format'] as string | undefined) ?? 'text';

      if (!allowedRecipients.includes(to)) {
        return {
          success: false,
          output: '',
          error: `recipient ${to} not in allowlist`,
        };
      }

      try {
        const result = await sender(
          to,
          subject,
          body,
          format as 'text' | 'html',
        );

        if (result.success) {
          return {
            success: true,
            output: `Email sent (messageId: ${result.messageId})`,
          };
        }

        return {
          success: false,
          output: '',
          error: `send_email failed: ${result.error}`,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `send_email failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  return [send_email];
}
