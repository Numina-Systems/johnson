// pattern: Functional Core — custom tool manager type + factory

import { createHash } from 'node:crypto';
import type { Store } from '../store/store.ts';

export type CustomTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly code: string;
  readonly approved: boolean;
  readonly codeHash: string;
  readonly secrets: ReadonlyArray<string>;
};

export type CustomToolManager = {
  listTools(): CustomTool[];
  getTool(name: string): CustomTool | undefined;
  saveTool(tool: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly code: string;
    readonly secrets?: ReadonlyArray<string>;
  }): CustomTool;
  approveTool(name: string): boolean;
  revokeTool(name: string): boolean;
  updateSecrets(name: string, secrets: ReadonlyArray<string>): boolean;
  getApprovedToolSummaries(): Array<{ name: string; description: string }>;
};

function computeHash(code: string, parameters: Record<string, unknown>): string {
  return createHash('sha256')
    .update(code + JSON.stringify(parameters))
    .digest('hex')
    .slice(0, 16);
}

function rkey(name: string): string {
  return `customtool:${name}`;
}

export function createCustomToolManager(store: Store): CustomToolManager {
  function deserialize(content: string): CustomTool | undefined {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
        return parsed as CustomTool;
      }
    } catch { /* corrupt document — skip */ }
    return undefined;
  }

  function listTools(): CustomTool[] {
    const result = store.docList(500);
    const tools: CustomTool[] = [];
    for (const doc of result.documents) {
      if (!doc.rkey.startsWith('customtool:')) continue;
      const tool = deserialize(doc.content);
      if (tool) tools.push(tool);
    }
    return tools;
  }

  function getTool(name: string): CustomTool | undefined {
    const doc = store.docGet(rkey(name));
    if (!doc) return undefined;
    return deserialize(doc.content);
  }

  function saveTool(input: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly code: string;
    readonly secrets?: ReadonlyArray<string>;
  }): CustomTool {
    const codeHash = computeHash(input.code, input.parameters);
    const existing = getTool(input.name);

    let approved = false;
    if (existing && existing.codeHash === codeHash) {
      approved = existing.approved;
    }

    const tool: CustomTool = {
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      code: input.code,
      approved,
      codeHash,
      secrets: input.secrets ?? [],
    };

    store.docUpsert(rkey(input.name), JSON.stringify(tool));
    return tool;
  }

  function approveTool(name: string): boolean {
    const existing = getTool(name);
    if (!existing) return false;
    const updated: CustomTool = { ...existing, approved: true };
    store.docUpsert(rkey(name), JSON.stringify(updated));
    return true;
  }

  function revokeTool(name: string): boolean {
    const existing = getTool(name);
    if (!existing) return false;
    const updated: CustomTool = { ...existing, approved: false };
    store.docUpsert(rkey(name), JSON.stringify(updated));
    return true;
  }

  function updateSecrets(name: string, secrets: ReadonlyArray<string>): boolean {
    const existing = getTool(name);
    if (!existing) return false;
    const updated: CustomTool = { ...existing, secrets };
    store.docUpsert(rkey(name), JSON.stringify(updated));
    return true;
  }

  function getApprovedToolSummaries(): Array<{ name: string; description: string }> {
    return listTools()
      .filter(t => t.approved)
      .map(t => ({ name: t.name, description: t.description }));
  }

  return { listTools, getTool, saveTool, approveTool, revokeTool, updateSecrets, getApprovedToolSummaries };
}
