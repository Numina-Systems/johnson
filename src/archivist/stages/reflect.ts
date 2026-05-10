// pattern: Functional Core + Imperative Shell

import type { Store } from '@/store/store.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { StageResult, BudgetTracker } from '../types.ts';
import { setArchivistSection } from './reflect-sections.ts';

// ── Imperative Shell: Store summarization ──────────────────────────────────

export type StoreSummary = {
  readonly totalDocs: number;
  readonly prefixCounts: Record<string, number>;
  readonly topicClusters: ReadonlyArray<string>;
  readonly recentArchiveDates: ReadonlyArray<string>;
};

export function summarizeStore(store: Store): StoreSummary {
  const prefixCounts: Record<string, number> = {};
  const topicClusters: Array<string> = [];
  const archiveDates = new Set<string>();
  let totalDocs = 0;

  let cursor: string | undefined;
  do {
    const page = store.docList(500, cursor);
    for (const doc of page.documents) {
      totalDocs++;

      const prefix = doc.rkey.includes(':') ? doc.rkey.split(':')[0]! : doc.rkey;
      prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;

      if (doc.rkey.startsWith('index:')) {
        const firstLine = doc.content.split('\n').find(l => l.startsWith('# '));
        topicClusters.push(firstLine ?? doc.rkey);
      }

      if (doc.rkey.startsWith('archive:')) {
        const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(doc.rkey);
        if (dateMatch) archiveDates.add(dateMatch[1]!);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  const sortedDates = Array.from(archiveDates).sort().reverse().slice(0, 10);

  return { totalDocs, prefixCounts, topicClusters, recentArchiveDates: sortedDates };
}

export function formatStoreSummary(summary: StoreSummary): string {
  const lines: Array<string> = [];
  lines.push(`Total documents: ${summary.totalDocs}`);
  lines.push('');
  lines.push('Documents by prefix:');
  for (const [prefix, count] of Object.entries(summary.prefixCounts).sort()) {
    lines.push(`  ${prefix}: ${count}`);
  }
  if (summary.topicClusters.length > 0) {
    lines.push('');
    lines.push('Topic clusters:');
    for (const cluster of summary.topicClusters) {
      lines.push(`  - ${cluster}`);
    }
  }
  if (summary.recentArchiveDates.length > 0) {
    lines.push('');
    lines.push('Recent archive dates:');
    for (const date of summary.recentArchiveDates) {
      lines.push(`  - ${date}`);
    }
  }
  return lines.join('\n');
}

// ── Imperative Shell: Reflect stage execution ──────────────────────────────

type ReflectDeps = {
  readonly store: Store;
  readonly subAgent?: SubAgentLLM;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function reflect(deps: ReflectDeps): Promise<StageResult> {
  // Skip if no sub-agent available
  if (!deps.subAgent) {
    return {
      stage: 'reflect',
      tokensUsed: 0,
      actions: [],
      skipped: true,
    };
  }

  const summary = summarizeStore(deps.store);
  const formattedSummary = formatStoreSummary(summary);

  const actions: Array<string> = [];
  let tokensUsed = 0;

  // Generate self observations (knowledge domains)
  const selfPrompt = `Given this document store state, identify knowledge domains, emerging topics, and stale areas. Write a concise summary (bullet points, max 200 words) suitable for the agent's identity document.

Store summary:
${formattedSummary}`;

  let selfObservations = '';
  try {
    selfObservations = await deps.subAgent.complete(selfPrompt, deps.systemPrompt);
    const selfTokens = Math.ceil(selfObservations.length / 4); // rough token estimate
    tokensUsed += selfTokens;
    deps.budget.record('reflect', selfTokens);
  } catch (error) {
    // Continue gracefully if sub-agent fails
    selfObservations = `Unable to generate observations (${error instanceof Error ? error.message : 'unknown error'})`;
  }

  // Load self document
  let selfDoc = deps.store.docGet('self');
  if (!selfDoc) {
    // Create self if missing
    deps.store.docUpsert('self', '');
    selfDoc = deps.store.docGet('self');
  }

  // Update knowledge-domains section in self
  const updatedSelfContent = setArchivistSection(
    selfDoc?.content ?? '',
    'knowledge-domains',
    selfObservations
  );
  deps.store.docUpsert('self', updatedSelfContent);
  actions.push('updated-section:self:knowledge-domains');

  // Generate operator observations (user patterns)
  const operatorPrompt = `Given this document store state, identify cross-session user patterns, focus shifts, and preferences. Write a concise summary (bullet points, max 200 words) suitable for the user context document.

Store summary:
${formattedSummary}`;

  let operatorObservations = '';
  try {
    operatorObservations = await deps.subAgent.complete(operatorPrompt, deps.systemPrompt);
    const operatorTokens = Math.ceil(operatorObservations.length / 4);
    tokensUsed += operatorTokens;
    deps.budget.record('reflect', operatorTokens);
  } catch (error) {
    operatorObservations = `Unable to generate observations (${error instanceof Error ? error.message : 'unknown error'})`;
  }

  // Load or create operator document
  let operatorDoc = deps.store.docGet('operator');
  if (!operatorDoc) {
    deps.store.docUpsert('operator', '');
    operatorDoc = deps.store.docGet('operator');
  }

  // Update user-patterns section in operator
  const updatedOperatorContent = setArchivistSection(
    operatorDoc?.content ?? '',
    'user-patterns',
    operatorObservations
  );
  deps.store.docUpsert('operator', updatedOperatorContent);
  actions.push('updated-section:operator:user-patterns');

  return {
    stage: 'reflect',
    tokensUsed,
    actions,
    skipped: false,
  };
}
