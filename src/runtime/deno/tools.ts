// Auto-generated tool stubs — do not edit
import { callTool } from "./runtime.ts";

/** Create or update a document by rkey. Documents are the agent's persistent memory. */
export async function doc_upsert(params: { rkey: string; content: string }): Promise<unknown> {
  return callTool("doc_upsert", params);
}

/** Read a document by rkey. Returns the document content or an error if not found. */
export async function doc_get(params: { rkey: string }): Promise<unknown> {
  return callTool("doc_get", params);
}

/** List all documents. Returns rkeys with timestamps. Use cursor for pagination. */
export async function doc_list(params: { limit?: number; cursor?: string }): Promise<unknown> {
  return callTool("doc_list", params);
}

/** Full-text search across all documents. Returns matching documents ranked by relevance. */
export async function doc_search(params: { query: string; limit?: number }): Promise<unknown> {
  return callTool("doc_search", params);
}

/** Run a previously saved skill by name. The skill must be granted (approved) to run with secrets. Pass arguments as an array of strings — each element stays intact (no whitespace splitting). Available as `__args` in the skill. Use doc_get to read the skill code first if you need to inspect it. */
export async function run_skill(params: { name: string; args?: Array<string> }): Promise<unknown> {
  return callTool("run_skill", params);
}

/** Schedule a prompt to run on a recurring schedule. When the task fires, a fresh agent session runs the prompt and delivers the response. Use cron expressions ("0 *\/6 * * *") or human intervals ("6h", "30m", "1d"). The prompt should be self-contained. Optionally add a trigger — TypeScript code that runs first in the Deno sandbox. If the trigger produces output, the prompt fires with that data as context. If it produces nothing, the prompt is skipped (zero tokens). Tasks without a trigger fire every time. */
export async function schedule_task(params: { name: string; prompt: string; schedule: string; deliver_to?: string; trigger?: string; skill?: string }): Promise<unknown> {
  return callTool("schedule_task", params);
}

/** List all scheduled tasks with their status, last run info, and run count. */
export async function list_tasks(params: Record<string, unknown>): Promise<unknown> {
  return callTool("list_tasks", params);
}

/** Cancel a scheduled task by its ID. Use list_tasks first to find the ID. */
export async function cancel_task(params: { id: string }): Promise<unknown> {
  return callTool("cancel_task", params);
}

/** Search the web via Exa AI. Returns ranked results with title, URL, snippet, and relevance score. Use this when you need to find information across the web. Optional `summary_focus` provides a query-focused summary in each snippet. */
export async function web_search(params: { query: string; num_results?: number; summary_focus?: string }): Promise<unknown> {
  return callTool("web_search", params);
}

/** Fetch a single web page through Exa AI and return its extracted text content along with metadata (title, author, publish date). Use this when you have a URL and need the readable text. For raw HTTP responses, use http_get instead. */
export async function fetch_page(params: { url: string; max_chars?: number }): Promise<unknown> {
  return callTool("fetch_page", params);
}

/** Issue a plain HTTP GET request and return the response status, content type, and body (truncated). Use for raw API responses, JSON endpoints, or files. For readable web page extraction, use fetch_page instead. */
export async function http_get(params: { url: string; max_chars?: number }): Promise<unknown> {
  return callTool("http_get", params);
}

/** Send a message to Discord via webhook. Requires DISCORD_WEBHOOK_URL secret. If title is provided, sends as a rich embed; otherwise sends as a plain message. Content is truncated to 2000 characters. */
export async function notify_discord(params: { content: string; title?: string }): Promise<unknown> {
  return callTool("notify_discord", params);
}

/** Summarize text using a sub-agent LLM. Returns a concise summary preserving key facts. */
export async function summarize(params: { text: string; instructions?: string; max_length?: "short" | "medium" | "long" }): Promise<unknown> {
  return callTool("summarize", params);
}
