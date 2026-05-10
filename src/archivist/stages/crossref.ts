// pattern: Imperative Shell

import { createHash } from 'node:crypto';
import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ChangeSet, StageResult } from '../types.ts';
import type { BudgetTracker } from '../types.ts';
import { isImmutable } from '../state.ts';
import { findSimilarPairs, type EmbeddingPair } from '../similarity.ts';

const RELATED_MARKER_PATTERN = /^<!-- related: .* -->\n?/;

export function stripRelatedMarker(content: string): string {
  return content.replace(RELATED_MARKER_PATTERN, '');
}

export function addRelatedMarker(content: string, relatedRkeys: ReadonlyArray<string>): string {
  if (relatedRkeys.length === 0) return stripRelatedMarker(content);
  const stripped = stripRelatedMarker(content);
  const marker = `<!-- related: ${relatedRkeys.join(', ')} -->`;
  return `${marker}\n${stripped}`;
}

export function parseRelatedMarker(content: string): ReadonlyArray<string> {
  const match = /^<!-- related: (.*) -->/.exec(content);
  if (!match) return [];
  return match[1]!.split(', ').map(s => s.trim()).filter(Boolean);
}

function buildIndexRkey(rkeys: ReadonlyArray<string>): string {
  const sorted = [...rkeys].sort();
  const hash = createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 8);
  return `index:cluster-${hash}`;
}

type CrossrefDeps = {
  readonly store: Store;
  readonly embedding: EmbeddingProvider;
  readonly subAgent?: SubAgentLLM;
  readonly threshold: number;
  readonly budget: BudgetTracker;
  readonly systemPrompt: string;
};

export async function crossref(
  deps: CrossrefDeps,
  changeSet: ChangeSet,
  mode: 'incremental' | 'full',
): Promise<StageResult> {
  // Graceful degradation: skip if no embedding provider
  if (!deps.embedding) {
    return {
      stage: 'crossref',
      tokensUsed: 0,
      actions: [],
      skipped: true,
    };
  }

  // Get all embeddings
  const allEmbeddings = deps.store.getAllEmbeddings();

  // Build set of immutable rkeys to exclude from marker additions
  const immutableRkeys = new Set<string>();
  const documentsToProcess = mode === 'full' ? Object.keys(Object.fromEntries(
    allEmbeddings.map(e => [e.rkey, true])
  )) : [...changeSet.added, ...changeSet.modified];

  // Filter out immutable documents from processing
  const mutableToProcess = documentsToProcess.filter(rkey => !isImmutable(rkey));

  // Find similar pairs
  const embeddings = allEmbeddings.map(e => ({
    rkey: e.rkey,
    embedding: e.embedding,
  } as EmbeddingPair));

  const pairs = findSimilarPairs(embeddings, deps.threshold, immutableRkeys);

  // Build adjacency map: rkey -> related rkeys
  const adjacencyMap = new Map<string, Set<string>>();
  for (const pair of pairs) {
    if (!adjacencyMap.has(pair.a)) adjacencyMap.set(pair.a, new Set());
    if (!adjacencyMap.has(pair.b)) adjacencyMap.set(pair.b, new Set());
    adjacencyMap.get(pair.a)!.add(pair.b);
    adjacencyMap.get(pair.b)!.add(pair.a);
  }

  const actions: Array<string> = [];

  // Add markers to mutable documents with related rkeys
  for (const rkey of mutableToProcess) {
    const relatedSet = adjacencyMap.get(rkey);
    if (!relatedSet) continue;

    const doc = deps.store.docGet(rkey);
    if (!doc) continue;

    const relatedArray = Array.from(relatedSet).sort();
    const newContent = addRelatedMarker(doc.content, relatedArray);

    if (newContent !== doc.content) {
      deps.store.docUpsert(rkey, newContent);
      actions.push(`added-marker:${rkey}`);
    }
  }

  // Find connected components (topic clusters)
  const clusters = findClusters(adjacencyMap);

  // Create or update index documents
  for (const cluster of clusters) {
    const indexRkey = buildIndexRkey(cluster);
    const indexDoc = await buildIndexDocument(deps, cluster);
    deps.store.docUpsert(indexRkey, indexDoc);
    actions.push(`updated-index:${indexRkey}`);
  }

  return {
    stage: 'crossref',
    tokensUsed: 0,
    actions,
    skipped: false,
  };
}

function findClusters(adjacencyMap: Map<string, Set<string>>): ReadonlyArray<ReadonlyArray<string>> {
  const visited = new Set<string>();
  const clusters: Array<Array<string>> = [];

  for (const startRkey of adjacencyMap.keys()) {
    if (visited.has(startRkey)) continue;

    const cluster: Array<string> = [];
    const stack = [startRkey];

    while (stack.length > 0) {
      const rkey = stack.pop()!;
      if (visited.has(rkey)) continue;

      visited.add(rkey);
      cluster.push(rkey);

      const related = adjacencyMap.get(rkey);
      if (related) {
        for (const r of related) {
          if (!visited.has(r)) {
            stack.push(r);
          }
        }
      }
    }

    if (cluster.length > 0) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

async function buildIndexDocument(
  deps: CrossrefDeps,
  cluster: ReadonlyArray<string>,
): Promise<string> {
  const sortedRkeys = [...cluster].sort();

  let topicName = 'Topic Cluster';
  let summary = '';

  // Generate summary if sub-agent is available
  if (deps.subAgent) {
    const docs = sortedRkeys
      .map(rkey => {
        const doc = deps.store.docGet(rkey);
        return doc ? `\n\n## ${rkey}\n\n${doc.content}` : null;
      })
      .filter(Boolean)
      .join('');

    const prompt = `Analyze these related documents and generate:
1. A concise topic name (2-4 words)
2. A 2-3 sentence summary of the common theme

Documents:${docs}`;

    try {
      const response = await deps.subAgent.complete(prompt, deps.systemPrompt);
      const parsed = parseSubAgentResponse(response);
      topicName = parsed.topicName || 'Topic Cluster';
      summary = parsed.summary || '';
    } catch {
      // Graceful fallback if sub-agent fails
      summary = `Collection of ${sortedRkeys.length} related documents`;
    }
  } else {
    summary = `Collection of ${sortedRkeys.length} related documents`;
  }

  const docList = sortedRkeys
    .map(rkey => `- \`${rkey}\``)
    .join('\n');

  return `<!-- archivist-managed -->
# Topic: ${topicName}

${summary}

## Related Documents
${docList}`;
}

function parseSubAgentResponse(response: string): { topicName: string; summary: string } {
  try {
    const parsed = JSON.parse(response);
    return {
      topicName: typeof parsed.topicName === 'string' ? parsed.topicName : 'Topic Cluster',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch {
    return { topicName: 'Topic Cluster', summary: '' };
  }
}
