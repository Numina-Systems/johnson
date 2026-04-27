// pattern: Functional Core — web tool handlers

import type { ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';

const EXA_KEY_MISSING_ERROR =
  'Exa API key not configured. Set EXA_API_KEY as a secret or environment variable.';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const EXA_CONTENTS_URL = 'https://api.exa.ai/contents';

const HTTP_GET_TIMEOUT_MS = 30_000;
const HTTP_GET_DEFAULT_MAX_CHARS = 10_000;
const HTTP_GET_HARD_MAX_CHARS = 50_000;
const FETCH_PAGE_DEFAULT_MAX_CHARS = 10_000;
const FETCH_PAGE_HARD_MAX_CHARS = 50_000;
const WEB_SEARCH_DEFAULT_NUM_RESULTS = 5;
const WEB_SEARCH_MIN_NUM_RESULTS = 1;
const WEB_SEARCH_MAX_NUM_RESULTS = 10;

function str(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== 'string') throw new Error(`missing required param: ${key}`);
  return val;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === 'string' ? val : undefined;
}

function optNum(input: Record<string, unknown>, key: string): number | undefined {
  const val = input[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function resolveExaKey(deps: Readonly<AgentDependencies>): string | undefined {
  return deps.secrets?.get('EXA_API_KEY') ?? process.env['EXA_API_KEY'];
}

type ExaSearchResult = {
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  summary?: string;
};

type ExaSearchResponse = {
  results?: Array<ExaSearchResult>;
};

type ExaContentsResult = {
  url?: string;
  title?: string;
  text?: string;
  author?: string;
  publishedDate?: string;
};

type ExaContentsResponse = {
  results?: Array<ExaContentsResult>;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  score: number | undefined;
};

export type FetchPageResult = {
  title: string;
  url: string;
  text: string;
  author?: string;
  publishDate?: string;
};

export type HttpGetResult = {
  status: number;
  contentType: string;
  body: string;
};

export function registerWebTools(
  registry: ToolRegistry,
  deps: Readonly<AgentDependencies>,
): void {
  registry.register(
    'web_search',
    {
      name: 'web_search',
      description:
        'Search the web via Exa AI. Returns ranked results with title, URL, snippet, and relevance score. Use this when you need to find information across the web. Optional `summary_focus` provides a query-focused summary in each snippet.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
          num_results: {
            type: 'number',
            description: 'Number of results to return (1-10, default 5).',
          },
          summary_focus: {
            type: 'string',
            description:
              'Optional focus query — when provided, each result snippet is a focused summary instead of raw text.',
          },
        },
        required: ['query'],
      },
    },
    async (params): Promise<WebSearchResult[] | string> => {
      const query = str(params, 'query');
      const numResultsRaw = optNum(params, 'num_results') ?? WEB_SEARCH_DEFAULT_NUM_RESULTS;
      const numResults = clamp(
        Math.trunc(numResultsRaw),
        WEB_SEARCH_MIN_NUM_RESULTS,
        WEB_SEARCH_MAX_NUM_RESULTS,
      );
      const summaryFocus = optStr(params, 'summary_focus');

      const exaKey = resolveExaKey(deps);
      if (!exaKey) return EXA_KEY_MISSING_ERROR;

      const body: Record<string, unknown> = {
        query,
        numResults,
        type: 'auto',
        contents: { text: { maxCharacters: 1000 } },
      };
      if (summaryFocus) {
        body['summary'] = true;
        body['summaryQuery'] = summaryFocus;
      }

      const response = await fetch(EXA_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': exaKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Exa search failed: ${response.status} ${response.statusText} ${text}`.trim());
      }

      const json = (await response.json()) as ExaSearchResponse;
      const results = json.results ?? [];
      return results.map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.summary ?? r.text ?? '',
        score: r.score,
      }));
    },
  );

  registry.register(
    'fetch_page',
    {
      name: 'fetch_page',
      description:
        'Fetch a single web page through Exa AI and return its extracted text content along with metadata (title, author, publish date). Use this when you have a URL and need the readable text. For raw HTTP responses, use http_get instead.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the page to fetch.' },
          max_chars: {
            type: 'number',
            description: 'Maximum characters of text to return (default 10000, capped at 50000).',
          },
        },
        required: ['url'],
      },
    },
    async (params): Promise<FetchPageResult | string> => {
      const url = str(params, 'url');
      const maxCharsRaw = optNum(params, 'max_chars') ?? FETCH_PAGE_DEFAULT_MAX_CHARS;
      const maxChars = clamp(Math.trunc(maxCharsRaw), 1, FETCH_PAGE_HARD_MAX_CHARS);

      const exaKey = resolveExaKey(deps);
      if (!exaKey) return EXA_KEY_MISSING_ERROR;

      const response = await fetch(EXA_CONTENTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': exaKey,
        },
        body: JSON.stringify({
          urls: [url],
          text: { maxCharacters: maxChars },
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Exa contents failed: ${response.status} ${response.statusText} ${text}`.trim());
      }

      const json = (await response.json()) as ExaContentsResponse;
      const results = json.results ?? [];
      const first = results[0];
      if (!first) {
        throw new Error(`Exa contents returned no results for URL: ${url}`);
      }

      const result: FetchPageResult = {
        title: first.title ?? '',
        url: first.url ?? url,
        text: first.text ?? '',
      };
      if (first.author !== undefined) result.author = first.author;
      if (first.publishedDate !== undefined) result.publishDate = first.publishedDate;
      return result;
    },
  );

  registry.register(
    'http_get',
    {
      name: 'http_get',
      description:
        'Issue a plain HTTP GET request and return the response status, content type, and body (truncated). Use for raw API responses, JSON endpoints, or files. For readable web page extraction, use fetch_page instead.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch.' },
          max_chars: {
            type: 'number',
            description: 'Maximum characters of body to return (default 10000, capped at 50000).',
          },
        },
        required: ['url'],
      },
    },
    async (params): Promise<HttpGetResult> => {
      const url = str(params, 'url');
      const maxCharsRaw = optNum(params, 'max_chars') ?? HTTP_GET_DEFAULT_MAX_CHARS;
      const maxChars = clamp(Math.trunc(maxCharsRaw), 1, HTTP_GET_HARD_MAX_CHARS);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(HTTP_GET_TIMEOUT_MS),
      });
      const fullBody = await response.text();
      const body = fullBody.length > maxChars ? fullBody.slice(0, maxChars) : fullBody;

      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? 'unknown',
        body,
      };
    },
  );
}
