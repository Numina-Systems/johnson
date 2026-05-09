import { describe, it, expect } from 'bun:test';
import { createEmailTools } from './tools.ts';
import type { SendEmailFn, SendResult } from './types.ts';

type MockSender = SendEmailFn & {
  calls: Array<{ to: string; subject: string; body: string; format: string }>;
};

function createMockSender(result: SendResult): MockSender {
  const calls: Array<{ to: string; subject: string; body: string; format: string }> = [];

  const sender = (async (
    to: string,
    subject: string,
    body: string,
    format: string,
  ): Promise<SendResult> => {
    calls.push({ to, subject, body, format });
    return result;
  }) as SendEmailFn & { calls: Array<{ to: string; subject: string; body: string; format: string }> };

  sender.calls = calls;
  return sender;
}

describe('agent-email.AC2.1: send_email with allowed recipient and success', () => {
  it('should call sender and return success ToolResult with messageId', async () => {
    const mockSender = createMockSender({
      success: true,
      messageId: 'msg-12345',
    });

    const tools = createEmailTools({
      sender: mockSender,
      allowedRecipients: ['allowed@example.com'],
    });

    const sendEmailTool = tools[0];
    if (!sendEmailTool) {
      throw new Error('send_email tool not found');
    }

    const result = await sendEmailTool.handler({
      to: 'allowed@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('msg-12345');
    expect(mockSender.calls.length).toBe(1);
    expect(mockSender.calls[0]?.to).toBe('allowed@example.com');
    expect(mockSender.calls[0]?.subject).toBe('Test');
    expect(mockSender.calls[0]?.body).toBe('Body');
  });
});

describe('agent-email.AC2.2: send_email defaults format to text', () => {
  it('should default format to text when not specified', async () => {
    const mockSender = createMockSender({
      success: true,
      messageId: 'msg-67890',
    });

    const tools = createEmailTools({
      sender: mockSender,
      allowedRecipients: ['allowed@example.com'],
    });

    const sendEmailTool = tools[0];
    if (!sendEmailTool) {
      throw new Error('send_email tool not found');
    }

    const result = await sendEmailTool.handler({
      to: 'allowed@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(true);
    expect(mockSender.calls.length).toBe(1);
    expect(mockSender.calls[0]?.format).toBe('text');
  });
});

describe('agent-email.AC2.3: send_email rejects recipient not in allowlist', () => {
  it('should reject recipient not in allowlist and not call sender', async () => {
    const mockSender = createMockSender({
      success: true,
      messageId: 'msg-99999',
    });

    const tools = createEmailTools({
      sender: mockSender,
      allowedRecipients: ['allowed@example.com'],
    });

    const sendEmailTool = tools[0];
    if (!sendEmailTool) {
      throw new Error('send_email tool not found');
    }

    const result = await sendEmailTool.handler({
      to: 'unauthorized@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowlist');
    expect(mockSender.calls.length).toBe(0);
  });
});

describe('agent-email.AC2.4: send_email propagates sender failure', () => {
  it('should propagate sender failure in ToolResult', async () => {
    const mockSender = createMockSender({
      success: false,
      error: 'connection refused',
    });

    const tools = createEmailTools({
      sender: mockSender,
      allowedRecipients: ['allowed@example.com'],
    });

    const sendEmailTool = tools[0];
    if (!sendEmailTool) {
      throw new Error('send_email tool not found');
    }

    const result = await sendEmailTool.handler({
      to: 'allowed@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});
