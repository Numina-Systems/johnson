// pattern: Functional Core + Registry
//
// Tool registry for the parent (Bun) process. Holds tool definitions and
// handlers, generates TypeScript stubs for the Deno sandbox, and produces
// markdown documentation for system prompts.

import type { ToolDefinition } from "../model/types.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

export type ToolMode = 'sandbox' | 'native' | 'both';

type RegistryEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
  mode: ToolMode;
};

export type ToolRegistry = {
  register(
    name: string,
    definition: ToolDefinition,
    handler: ToolHandler,
    mode?: ToolMode,
  ): void;
  get(
    name: string,
  ): { definition: ToolDefinition; handler: ToolHandler } | undefined;
  list(): Array<{ name: string; definition: ToolDefinition }>;
  execute(name: string, params: Record<string, unknown>): Promise<unknown>;
  generateToolDefinitions(): ToolDefinition[];
  generateTypeScriptStubs(): string;
  generateToolDocumentation(): string;
};

// ── JSON Schema → TypeScript type mapping ──────────────────────────────────

type JsonSchemaProperty = {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

function jsonSchemaTypeToTs(schema: JsonSchemaProperty): string {
  if (!schema.type) {
    return "unknown";
  }

  switch (schema.type) {
    case "string":
      return schema.enum
        ? schema.enum.map((v) => JSON.stringify(v)).join(" | ")
        : "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      if (schema.items) {
        return `Array<${jsonSchemaTypeToTs(schema.items)}>`;
      }
      return "unknown[]";
    case "object":
      if (schema.properties) {
        const entries = Object.entries(schema.properties).map(
          ([key, prop]) => {
            const optional = schema.required?.includes(key) ? "" : "?";
            return `${key}${optional}: ${jsonSchemaTypeToTs(prop)}`;
          },
        );
        return `{ ${entries.join("; ")} }`;
      }
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

/**
 * Build a TypeScript params type string from a tool's input_schema.
 * Returns something like `{ filename: string; content: string }`.
 */
function buildParamsType(inputSchema: Record<string, unknown>): string {
  const schema = inputSchema as JsonSchemaObject;
  const properties = schema.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return "Record<string, unknown>";
  }

  const requiredSet = new Set<string>(schema.required ?? []);
  const fields: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const optional = requiredSet.has(name) ? "" : "?";
    const tsType = jsonSchemaTypeToTs(prop);
    fields.push(`${name}${optional}: ${tsType}`);
  }

  return `{ ${fields.join("; ")} }`;
}

// ── Registry factory ───────────────────────────────────────────────────────

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, RegistryEntry>();

  function register(
    name: string,
    definition: ToolDefinition,
    handler: ToolHandler,
    mode: ToolMode = 'sandbox',
  ): void {
    entries.set(name, { definition, handler, mode });
  }

  function generateToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [, entry] of entries) {
      if (entry.mode === 'native' || entry.mode === 'both') {
        definitions.push(entry.definition);
      }
    }
    return definitions;
  }

  function get(
    name: string,
  ): { definition: ToolDefinition; handler: ToolHandler } | undefined {
    return entries.get(name);
  }

  function list(): Array<{ name: string; definition: ToolDefinition }> {
    return Array.from(entries.entries()).map(([name, entry]) => ({
      name,
      definition: entry.definition,
    }));
  }

  async function execute(
    name: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = entries.get(name);
    if (!entry) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return entry.handler(params);
  }

  /**
   * Generate a TypeScript stubs file that Deno sandbox code can import.
   * Each registered tool is a named export. The executor preamble does:
   *   import * as tools from "./tools.ts";
   * So the model writes `await tools.save_note({...})` — one consistent pattern.
   */
  function generateTypeScriptStubs(): string {
    const lines: string[] = [
      "// Auto-generated tool stubs — do not edit",
      'import { callTool } from "./runtime.ts";',
      "",
    ];

    for (const [name, entry] of entries) {
      if (entry.mode === 'native') continue;
      const paramsType = buildParamsType(entry.definition.input_schema);
      // Escape */ in descriptions to avoid prematurely closing JSDoc comments
      const safeDesc = (entry.definition.description ?? '').split('\n')[0]!.replace(/\*\//g, '*\\/');
      lines.push(
        `/** ${safeDesc} */`,
        `export async function ${name}(params: ${paramsType}): Promise<unknown> {`,
        `  return callTool("${name}", params);`,
        `}`,
        "",
      );
    }

    return lines.join("\n");
  }

  /**
   * Generate markdown documentation of all registered tools,
   * suitable for injection into a system prompt.
   */
  function generateToolDocumentation(): string {
    const sections: string[] = ["## Available Tools", ""];

    for (const [name, entry] of entries) {
      const def = entry.definition;

      if (entry.mode === 'native' || entry.mode === 'both') {
        sections.push(`### \`${name}\` *(direct tool call)*`);
        sections.push("");
        if (entry.mode === 'both') {
          sections.push(`> Available as both a direct tool call and via \`tools.${name}()\` in execute_code.`);
        } else {
          sections.push(`> Call this tool directly — do NOT use execute_code for this tool.`);
        }
        sections.push("");
      } else {
        sections.push(`### \`tools.${name}\``);
        sections.push("");
      }

      sections.push(def.description);
      sections.push("");

      const schema = def.input_schema as JsonSchemaObject;
      const properties = schema.properties;
      if (properties && Object.keys(properties).length > 0) {
        const requiredSet = new Set<string>(schema.required ?? []);
        sections.push("**Parameters:**");
        sections.push("");

        for (const [paramName, prop] of Object.entries(properties)) {
          const required = requiredSet.has(paramName) ? " *(required)*" : " *(optional)*";
          const tsType = jsonSchemaTypeToTs(prop);
          const desc = prop.description ? ` — ${prop.description}` : "";
          sections.push(`- \`${paramName}\`: \`${tsType}\`${required}${desc}`);
        }
        sections.push("");
      }
    }

    return sections.join("\n");
  }

  return {
    register,
    get,
    list,
    execute,
    generateToolDefinitions,
    generateTypeScriptStubs,
    generateToolDocumentation,
  };
}
