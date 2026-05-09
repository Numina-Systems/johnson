/**
 * Registration tests for email tools.
 * Verifies conditional registration and stub generation.
 */

import { describe, it, expect } from 'bun:test';
import { createToolRegistry } from '@/tool/registry.ts';
import { createEmailTools } from './tools.ts';
import type { SendEmailFn } from './types.ts';

describe('email tool registration', () => {
  describe('agent-email.AC3.1: send_email in registry when tools registered', () => {
    it('should include send_email in registry definitions when registered', () => {
      const registry = createToolRegistry();

      const mockSender: SendEmailFn = async () => ({
        success: true,
        messageId: 'msg-123',
      });

      const emailTools = createEmailTools({
        sender: mockSender,
        allowedRecipients: ['allowed@example.com'],
      });

      for (const tool of emailTools) {
        registry.register(tool);
      }

      const definitions = registry.getDefinitions();

      expect(definitions.length).toBeGreaterThanOrEqual(1);
      const sendEmailDef = definitions.find((d) => d.name === 'send_email');
      expect(sendEmailDef).toBeDefined();
      expect(sendEmailDef?.name).toBe('send_email');
      expect(sendEmailDef?.description).toContain('email');
    });

    it('should include correct parameters in send_email definition', () => {
      const registry = createToolRegistry();

      const mockSender: SendEmailFn = async () => ({
        success: true,
        messageId: 'msg-123',
      });

      const emailTools = createEmailTools({
        sender: mockSender,
        allowedRecipients: ['allowed@example.com'],
      });

      for (const tool of emailTools) {
        registry.register(tool);
      }

      const definitions = registry.getDefinitions();
      const sendEmailDef = definitions.find((d) => d.name === 'send_email');

      expect(sendEmailDef).toBeDefined();
      const paramNames = sendEmailDef?.parameters.map((p) => p.name) ?? [];

      expect(paramNames).toContain('to');
      expect(paramNames).toContain('subject');
      expect(paramNames).toContain('body');
      expect(paramNames).toContain('format');

      const toParam = sendEmailDef?.parameters.find((p) => p.name === 'to');
      expect(toParam?.required).toBe(true);
      expect(toParam?.type).toBe('string');

      const formatParam = sendEmailDef?.parameters.find((p) => p.name === 'format');
      expect(formatParam?.required).toBe(false);
      expect(formatParam?.enum_values).toEqual(['text', 'html']);
    });
  });

  describe('agent-email.AC3.2: send_email absent when not registered', () => {
    it('should not include send_email when tools are not registered', () => {
      const registry = createToolRegistry();

      // Don't register any email tools

      const definitions = registry.getDefinitions();
      const sendEmailDef = definitions.find((d) => d.name === 'send_email');

      expect(sendEmailDef).toBeUndefined();
    });
  });

  describe('IPC stub generation', () => {
    it('should generate send_email function stub with correct signature', () => {
      const registry = createToolRegistry();

      const mockSender: SendEmailFn = async () => ({
        success: true,
        messageId: 'msg-123',
      });

      const emailTools = createEmailTools({
        sender: mockSender,
        allowedRecipients: ['allowed@example.com'],
      });

      for (const tool of emailTools) {
        registry.register(tool);
      }

      const stubs = registry.generateStubs();

      expect(stubs).toContain('async function send_email');
      expect(stubs).toContain('__callTool__("send_email"');
      expect(stubs).toContain('to: string');
      expect(stubs).toContain('subject: string');
      expect(stubs).toContain('body: string');
      expect(stubs).toContain('format?: string');
    });
  });
});
