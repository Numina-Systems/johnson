import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt, type SystemPromptParams } from './prompt.ts';
import type { RecalledContextEntry } from './types.ts';

/**
 * Helper factory to create minimal valid SystemPromptParams.
 */
function makeParams(overrides?: Partial<SystemPromptParams>): SystemPromptParams {
  return {
    selfDoc: '',
    skillNames: [],
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  // ============================================================================
  // AC6.1: Template block inclusion/exclusion
  // ============================================================================

  describe('static sections always present', () => {
    test('includes Memory Check section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Before You Act — Check Your Memory');
      expect(prompt).toContain('Discord threads and scheduled tasks have persistent conversation history');
    });

    test('includes Tool Calling section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('# How You Call Tools — READ THIS CAREFULLY');
      expect(prompt).toContain('## Sandbox tools — via `execute_code`');
      expect(prompt).toContain('## Native tools — direct function calls');
    });

    test('includes Documents section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Documents — Your Memory System');
      expect(prompt).toContain('Conventional rkeys');
      expect(prompt).toContain('`self` — your own notes about yourself');
    });

    test('includes Chaining section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Chaining Tool Calls');
      expect(prompt).toContain('When a task requires multiple steps, CHAIN your execute_code calls');
    });

    test('includes Error Handling section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Error Handling');
      expect(prompt).toContain('When a tool call fails, read the error carefully before retrying');
    });

    test('includes Current Time section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Current Time');
    });

    test('includes Available Skills section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Available Skills');
    });

    test('always includes Custom Tools template section', () => {
      const prompt = buildSystemPrompt(makeParams());
      expect(prompt).toContain('## Custom Tools');
      expect(prompt).toContain('tools.create_custom_tool');
    });
  });

  describe('conditional sections - recalled context', () => {
    test('omits Recalled Context section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ recalledContext: undefined }));
      expect(prompt).not.toContain('## Recalled Context');
    });

    test('omits Recalled Context section when empty array', () => {
      const prompt = buildSystemPrompt(makeParams({ recalledContext: [] }));
      expect(prompt).not.toContain('## Recalled Context');
    });

    test('includes Recalled Context section when non-empty', () => {
      const recalledContext: RecalledContextEntry[] = [
        { rkey: 'knowledge:meetings', content: 'Tuesday meeting notes' },
      ];
      const prompt = buildSystemPrompt(makeParams({ recalledContext }));
      expect(prompt).toContain('## Recalled Context');
      expect(prompt).toContain('### knowledge:meetings');
      expect(prompt).toContain('Tuesday meeting notes');
    });
  });

  describe('conditional sections - tool docs', () => {
    test('omits Tool Reference section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ toolDocs: undefined }));
      expect(prompt).not.toContain('## Tool Reference');
    });

    test('omits Tool Reference section when empty string', () => {
      const prompt = buildSystemPrompt(makeParams({ toolDocs: '' }));
      expect(prompt).not.toContain('## Tool Reference');
    });

    test('omits Tool Reference section when whitespace only', () => {
      const prompt = buildSystemPrompt(makeParams({ toolDocs: '   \n  ' }));
      expect(prompt).not.toContain('## Tool Reference');
    });

    test('includes Tool Reference section when provided', () => {
      const prompt = buildSystemPrompt(makeParams({ toolDocs: '- web_search: search the web' }));
      expect(prompt).toContain('## Tool Reference');
      expect(prompt).toContain('- web_search: search the web');
    });
  });

  describe('conditional sections - custom tools list', () => {
    test('omits Custom Tools list section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ customToolSummaries: undefined }));
      expect(prompt).not.toContain('## Custom Tools (call via tools.call_custom_tool)');
    });

    test('omits Custom Tools list section when empty array', () => {
      const prompt = buildSystemPrompt(makeParams({ customToolSummaries: [] }));
      expect(prompt).not.toContain('## Custom Tools (call via tools.call_custom_tool)');
    });

    test('includes Custom Tools list section when non-empty', () => {
      const customToolSummaries = [
        { name: 'fetch-weather', description: 'Get current weather' },
      ];
      const prompt = buildSystemPrompt(makeParams({ customToolSummaries }));
      expect(prompt).toContain('## Custom Tools (call via tools.call_custom_tool)');
      expect(prompt).toContain('fetch-weather');
      expect(prompt).toContain('Get current weather');
    });
  });

  // ============================================================================
  // AC6.2: Conditional blocks appearance/disappearance
  // ============================================================================

  describe('skills list conditional appearance', () => {
    test('shows empty message when skillNames is empty', () => {
      const prompt = buildSystemPrompt(makeParams({ skillNames: [] }));
      expect(prompt).toContain('No skills saved yet');
      expect(prompt).toContain('`skill:<name>` rkey');
    });

    test('shows skills list when skillNames has entries', () => {
      const prompt = buildSystemPrompt(makeParams({
        skillNames: ['skill:weather', 'skill:news'],
      }));
      expect(prompt).toContain('You can run these saved skills');
      expect(prompt).toContain('- skill:weather');
      expect(prompt).toContain('- skill:news');
    });

    test('does not show empty message when skills present', () => {
      const prompt = buildSystemPrompt(makeParams({
        skillNames: ['skill:weather'],
      }));
      expect(prompt).not.toContain('No skills saved yet');
    });
  });

  // ============================================================================
  // AC6.3: Interpolation of dynamic placeholders
  // ============================================================================

  describe('timezone interpolation', () => {
    test('replaces {timezone} with provided timezone', () => {
      const prompt = buildSystemPrompt(makeParams({ timezone: 'America/New_York' }));
      expect(prompt).toContain('(America/New_York)');
      expect(prompt).toContain('All times you present to the user MUST be in America/New_York');
    });

    test('defaults to UTC when not provided', () => {
      const prompt = buildSystemPrompt(makeParams({ timezone: undefined }));
      expect(prompt).toContain('(UTC)');
      expect(prompt).toContain('All times you present to the user MUST be in UTC');
    });

    test('uses default UTC when empty string', () => {
      const prompt = buildSystemPrompt(makeParams({ timezone: '' }));
      // Empty string is falsy, should default to UTC
      expect(prompt).toContain('(UTC)');
    });
  });

  describe('current time formatting', () => {
    test('includes formatted date/time in correct format', () => {
      const prompt = buildSystemPrompt(makeParams());
      // Format: "Monday, May 08, 2026, 2:30 PM UTC" (example)
      // Just verify the pattern is there, not exact values
      expect(prompt).toMatch(/\d{1,2}:\d{2}\s[AP]M/);
    });
  });

  describe('native tools interpolation', () => {
    test('interpolates native tool names when provided', () => {
      const prompt = buildSystemPrompt(makeParams({
        nativeToolNames: ['view_image', 'summarize'],
      }));
      expect(prompt).toContain('Currently:');
      expect(prompt).toContain('`view_image`');
      expect(prompt).toContain('`summarize`');
      expect(prompt).toContain('*(native only)*');
    });

    test('omits tool bullet list when nativeToolNames empty', () => {
      const prompt = buildSystemPrompt(makeParams({
        nativeToolNames: [],
      }));
      expect(prompt).toContain('## Native tools — direct function calls');
      expect(prompt).not.toContain('Currently:');
    });

    test('uses fallback text when nativeToolNames undefined', () => {
      const prompt = buildSystemPrompt(makeParams({
        nativeToolNames: undefined,
      }));
      expect(prompt).toContain('See the Tool Reference section below');
    });
  });

  describe('self doc interpolation', () => {
    test('interpolates self doc content into section', () => {
      const selfDoc = 'I prefer concise responses. I like emoji.';
      const prompt = buildSystemPrompt(makeParams({ selfDoc }));
      expect(prompt).toContain('## Your Memory (auto-loaded)');
      expect(prompt).toContain(selfDoc);
    });

    test('includes section header with empty selfDoc (per AC2.6)', () => {
      const prompt = buildSystemPrompt(makeParams({ selfDoc: '' }));
      expect(prompt).toContain('## Your Memory (auto-loaded)');
      expect(prompt).toContain('This is your saved identity and memory:');
    });
  });

  describe('recalled context formatting', () => {
    test('formats entries as ### rkey with content', () => {
      const recalledContext: RecalledContextEntry[] = [
        { rkey: 'knowledge:meetings', content: 'Meeting notes' },
      ];
      const prompt = buildSystemPrompt(makeParams({ recalledContext }));
      expect(prompt).toContain('### knowledge:meetings\nMeeting notes');
    });

    test('joins multiple entries with double newline', () => {
      const recalledContext: RecalledContextEntry[] = [
        { rkey: 'task:project-a', content: 'Status: blocked' },
        { rkey: 'task:project-b', content: 'Status: in progress' },
      ];
      const prompt = buildSystemPrompt(makeParams({ recalledContext }));
      expect(prompt).toContain('### task:project-a\nStatus: blocked\n\n### task:project-b\nStatus: in progress');
    });
  });

  describe('custom tool summaries formatting', () => {
    test('formats each tool as - **name** — description', () => {
      const customToolSummaries = [
        { name: 'fetch-weather', description: 'Get current weather' },
        { name: 'send-email', description: 'Send an email' },
      ];
      const prompt = buildSystemPrompt(makeParams({ customToolSummaries }));
      expect(prompt).toContain('- **fetch-weather** — Get current weather');
      expect(prompt).toContain('- **send-email** — Send an email');
    });
  });

  // ============================================================================
  // AC6.4: Assembly order verification
  // ============================================================================

  describe('section assembly order', () => {
    test('maintains correct section order', () => {
      const customToolSummaries = [
        { name: 'tool1', description: 'Tool 1' },
      ];
      const recalledContext: RecalledContextEntry[] = [
        { rkey: 'knowledge:test', content: 'Test content' },
      ];

      const prompt = buildSystemPrompt(makeParams({
        skillNames: ['skill:test'],
        toolDocs: 'Tool documentation',
        recalledContext,
        customToolSummaries,
      }));

      // Find indices
      const memoryCheckIdx = prompt.indexOf('## Before You Act — Check Your Memory');
      const toolCallingIdx = prompt.indexOf('# How You Call Tools');
      const documentsIdx = prompt.indexOf('## Documents — Your Memory System');
      const chainingIdx = prompt.indexOf('## Chaining Tool Calls');
      const errorHandlingIdx = prompt.indexOf('## Error Handling');
      const currentTimeIdx = prompt.indexOf('## Current Time');
      const selfDocIdx = prompt.indexOf('## Your Memory (auto-loaded)');
      const recalledContextIdx = prompt.indexOf('## Recalled Context');
      const skillsIdx = prompt.indexOf('## Available Skills');
      const toolRefIdx = prompt.indexOf('## Tool Reference');
      const customToolsIdx = prompt.indexOf('## Custom Tools\n\nYou can create');
      const customToolsListIdx = prompt.indexOf('## Custom Tools (call via tools.call_custom_tool)');

      // Verify ordering (all indices must be increasing)
      expect(memoryCheckIdx < toolCallingIdx).toBe(true);
      expect(toolCallingIdx < documentsIdx).toBe(true);
      expect(documentsIdx < chainingIdx).toBe(true);
      expect(chainingIdx < errorHandlingIdx).toBe(true);
      expect(errorHandlingIdx < currentTimeIdx).toBe(true);
      expect(currentTimeIdx < selfDocIdx).toBe(true);
      expect(selfDocIdx < recalledContextIdx).toBe(true);
      expect(recalledContextIdx < skillsIdx).toBe(true);
      expect(skillsIdx < toolRefIdx).toBe(true);
      expect(toolRefIdx < customToolsIdx).toBe(true);
      expect(customToolsIdx < customToolsListIdx).toBe(true);
    });
  });

  // ============================================================================
  // AC2.6: Empty selfDoc handling
  // ============================================================================

  describe('empty selfDoc handling', () => {
    test('includes section header with empty content', () => {
      const prompt = buildSystemPrompt(makeParams({ selfDoc: '' }));
      expect(prompt).toContain('## Your Memory (auto-loaded)');
      expect(prompt).toContain('This is your saved identity and memory:');
    });

    test('produces valid prompt with empty selfDoc', () => {
      const prompt = buildSystemPrompt(makeParams({ selfDoc: '' }));
      // Should not have any syntax errors or empty lines where sections are expected
      expect(prompt).toBeTruthy();
      expect(prompt.length > 0).toBe(true);
      // Verify key sections still present
      expect(prompt).toContain('## Before You Act');
      expect(prompt).toContain('## Documents');
    });
  });

  // ============================================================================
  // AC1.4: Build compilation check (implicit through test execution)
  // ============================================================================

  describe('template constants compilation', () => {
    test('all template constants resolve and interpolate', () => {
      // This test implicitly verifies AC1.4 by successfully calling buildSystemPrompt
      // If any template constant referenced a removed symbol, this would fail at compile time
      const prompt = buildSystemPrompt(makeParams({
        selfDoc: 'Test self doc',
        skillNames: ['skill:test'],
        toolDocs: 'Test tool docs',
        timezone: 'UTC',
        recalledContext: [{ rkey: 'test', content: 'Test content' }],
        customToolSummaries: [{ name: 'test', description: 'Test' }],
        nativeToolNames: ['test_tool'],
      }));
      expect(prompt).toBeTruthy();
      expect(prompt.length > 0).toBe(true);
    });
  });

  // ============================================================================
  // AC2.3: Optional params omitted when empty/undefined
  // ============================================================================

  describe('optional params omission', () => {
    test('omits toolDocs section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ toolDocs: undefined }));
      expect(prompt).not.toContain('## Tool Reference');
    });

    test('omits recalledContext section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ recalledContext: undefined }));
      expect(prompt).not.toContain('## Recalled Context');
    });

    test('omits customToolSummaries section when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({ customToolSummaries: undefined }));
      expect(prompt).not.toContain('## Custom Tools (call via tools.call_custom_tool)');
    });

    test('includes all optional sections when provided', () => {
      const prompt = buildSystemPrompt(makeParams({
        toolDocs: 'tools available',
        recalledContext: [{ rkey: 'test', content: 'content' }],
        customToolSummaries: [{ name: 'tool', description: 'desc' }],
      }));
      expect(prompt).toContain('## Tool Reference');
      expect(prompt).toContain('## Recalled Context');
      expect(prompt).toContain('## Custom Tools (call via tools.call_custom_tool)');
    });
  });

  // ============================================================================
  // AC2.5: Dynamic placeholder interpolation
  // ============================================================================

  describe('all dynamic placeholders interpolate correctly', () => {
    test('timezone placeholder replaced', () => {
      const prompt = buildSystemPrompt(makeParams({ timezone: 'Europe/London' }));
      expect(prompt).not.toContain('{timezone}');
      expect(prompt).toContain('Europe/London');
    });

    test('self_doc placeholder replaced', () => {
      const selfDoc = 'My custom self doc';
      const prompt = buildSystemPrompt(makeParams({ selfDoc }));
      expect(prompt).not.toContain('{self_doc}');
      expect(prompt).toContain(selfDoc);
    });

    test('native_tools_list placeholder replaced', () => {
      const prompt = buildSystemPrompt(makeParams({
        nativeToolNames: ['view_image'],
      }));
      expect(prompt).not.toContain('{native_tools_list}');
      expect(prompt).toContain('view_image');
    });

    test('fragments placeholder replaced in recalled context', () => {
      const prompt = buildSystemPrompt(makeParams({
        recalledContext: [{ rkey: 'test', content: 'content' }],
      }));
      expect(prompt).not.toContain('{fragments}');
      expect(prompt).toContain('### test');
    });

    test('custom_tools_list placeholder replaced', () => {
      const prompt = buildSystemPrompt(makeParams({
        customToolSummaries: [{ name: 'tool', description: 'desc' }],
      }));
      expect(prompt).not.toContain('{custom_tools_list}');
      expect(prompt).toContain('- **tool**');
    });

    test('skills placeholder replaced', () => {
      const prompt = buildSystemPrompt(makeParams({
        skillNames: ['skill:test'],
      }));
      expect(prompt).not.toContain('{skills}');
      expect(prompt).toContain('- skill:test');
    });

    test('tool_docs placeholder replaced', () => {
      const toolDocs = 'Test tool documentation';
      const prompt = buildSystemPrompt(makeParams({ toolDocs }));
      expect(prompt).not.toContain('{tool_docs}');
      expect(prompt).toContain(toolDocs);
    });

    test('secret_names placeholder replaced when provided', () => {
      const prompt = buildSystemPrompt(makeParams({
        secretNames: ['OPENAI_API_KEY', 'DATABASE_URL'],
      }));
      expect(prompt).not.toContain('{secret_names}');
      expect(prompt).toContain('Configured secrets: `OPENAI_API_KEY`, `DATABASE_URL`');
    });

    test('secret_names placeholder omitted when empty', () => {
      const prompt = buildSystemPrompt(makeParams({
        secretNames: [],
      }));
      expect(prompt).not.toContain('{secret_names}');
      expect(prompt).not.toContain('Configured secrets:');
    });

    test('secret_names placeholder omitted when undefined', () => {
      const prompt = buildSystemPrompt(makeParams({
        secretNames: undefined,
      }));
      expect(prompt).not.toContain('{secret_names}');
      expect(prompt).not.toContain('Configured secrets:');
    });
  });
});
