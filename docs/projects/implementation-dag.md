# Implementation DAG — Reviewed & Ready

This document directs implementation in the correct order based on the dependency graph, cross-plan review findings, and merge-conflict hotspot analysis. All 14 implementation plans have been reviewed in two passes; critical issues have been fixed on their respective branches.

## Branches

Each feature has a worktree at `.worktrees/GH{NN}` on branch `GH{NN}` with its implementation plan at `docs/projects/{N}/implementation-plan/`.

## Wave Execution Order

Implementation proceeds in 4 waves. **Within each wave, features can be implemented in parallel.** At each wave boundary, merge all completed branches into an integration branch before starting the next wave.

---

### Wave 0 — Foundations (no dependencies)

All three are independent. Implement in parallel.

| Branch | Feature | Phases | Key File | Notes |
|--------|---------|--------|----------|-------|
| `GH14` | Standalone Secrets Management | 1 | `src/secrets/manager.ts` | Changes `set()`/`remove()` to async. All downstream mock SecretManagers must use `async` methods. |
| `GH11` | Extended Thinking / Reasoning | 3 | `src/model/types.ts`, providers, `agent.ts` | Adds `reasoning_content` to `ModelResponse` and `Message`. |
| `GH01` | Graceful Max-Iteration Exhaustion | 1 | `src/agent/agent.ts` | Adds forced final response when tool rounds exhaust. |

**Merge gate:** All three pass `bun run build` and `bun test`. Resolve any conflicts in `src/agent/agent.ts` (GH01 + GH11 both touch it).

---

### Wave 1 — Core Infrastructure (depends on Wave 0)

All four are independent of each other. Implement in parallel.

| Branch | Feature | Phases | Key Files | Notes |
|--------|---------|--------|-----------|-------|
| `GH03` | Multi-Tool Architecture | 4 | `tool-registry.ts`, `agent.ts`, `types.ts` | **Largest Wave 1 item.** Adds `mode` to registry, widens `ToolResultBlock.content`, adds native dispatch. Foundation for Wave 2 tools. |
| `GH04` | Sub-Agent LLM | 4 | `config/`, `model/sub-agent.ts`, `agent/types.ts`, `compaction.ts` | Creates `SubAgentLLM` type at `src/model/sub-agent.ts`. GH05 and GH08 import from here. |
| `GH02` | Event Emission / Lifecycle Hooks | 2 | `agent/types.ts`, `agent.ts` | Adds `onEvent` to `ChatOptions` and 4 emit points in the agent loop. |
| `GH12` | Dynamic System Prompt Provider | 2 | `agent/types.ts`, `agent.ts`, `index.ts` | Refactors prompt building into provider/fallback pattern. GH10 appends to this. |

**Merge gate:** All four pass `bun run build` and `bun test`. **`src/agent/agent.ts` is a hotspot** — GH01 (from Wave 0), GH02, GH03, and GH12 all modify it. Merge agent.ts carefully; consider having one person handle all agent.ts conflicts at this gate.

**`src/agent/types.ts` hotspot:** GH02 adds `onEvent` to `ChatOptions`; GH04 adds `subAgent` to `AgentDependencies`; GH12 adds `systemPromptProvider` to `AgentDependencies`. All are optional fields — should auto-merge cleanly but verify.

---

### Wave 2 — Tools and Features (depends on Wave 1)

All five are independent of each other. Implement in parallel.

| Branch | Feature | Phases | Key Files | Depends On | Notes |
|--------|---------|--------|-----------|------------|-------|
| `GH07` | Built-In Web Tools | 2 | `src/tools/web.ts` (new), `agent/tools.ts` | GH03, GH14 | Exa search + fetch + plain HTTP GET. |
| `GH06` | Outbound Notification (Discord) | 2 | `src/tools/notify.ts` (new), `agent/tools.ts` | GH03, GH14 | Discord webhook POST. |
| `GH09` | Image Viewing Tool | 3 | `src/tools/image.ts` (new), `agent.ts`, `types.ts` | GH03 | **Review fix applied:** updates GH03's `formatNativeToolResult` instead of duplicating. Add `type: 'image'` branch to `toolResultContentToString` during implementation. |
| `GH08` | Summarization Tool | 2 | `src/tools/summarize.ts` (new), `agent/tools.ts` | GH03, GH04 | Uses `SubAgentLLM` from GH04. Verify 4-arg `registry.register()` exists (from GH03) before using `mode: 'both'`. |
| `GH05` | Auto-Generated Session Titles | 2 | `src/agent/session-title.ts` (new), `agent.ts`, `types.ts` | GH04 | **Review fix applied:** imports `SubAgentLLM` from `src/model/sub-agent.ts` (GH04). |

**Merge gate:** All five pass `bun run build` and `bun test`. `src/agent/tools.ts` is touched by GH06, GH07, GH08, and GH09 (all adding registrations) — merges should be additive. `src/agent/agent.ts` is touched by GH05 and GH09.

---

### Wave 3 — Integration Features (depends on Wave 2)

GH10 must complete before GH13 can start (GH13 depends on GH10).

| Branch | Feature | Phases | Key Files | Depends On | Notes |
|--------|---------|--------|-----------|------------|-------|
| `GH10` | Custom Tool Creation + Approval | 3 | `src/tools/custom-tool-manager.ts` (new), `src/tools/custom-tools.ts` (new), `agent/tools.ts`, `index.ts` | GH03, GH14 | **Review fix applied:** system prompt append works with GH12's provider/fallback. |
| `GH13` | Multi-Screen TUI | 7 | `src/tui/` (major refactor), `index.ts` | GH02, GH05, GH10, GH14 | **Largest feature.** 7 phases, 7 new screen files. Starts after GH10 completes. Phase 4 builtinTools approach: pre-generate in `index.ts` via `createAgentTools()`. |

**Merge gate:** Final integration. Full build + test + manual TUI walkthrough.

---

## Edge List (for tooling / automation)

```
GH04 → GH14
GH07 → GH03, GH14
GH06 → GH03, GH14
GH09 → GH03
GH08 → GH03, GH04
GH05 → GH04
GH10 → GH03, GH14
GH13 → GH02, GH05, GH10, GH14
```

## Merge Conflict Hotspots

These files are modified by multiple plans. At each wave gate, merge them with extra care.

| File | Modified By | Risk |
|------|-------------|------|
| `src/agent/agent.ts` | GH01, GH02, GH03, GH05, GH09, GH11, GH12 | **HIGH** — 7 plans touch this file |
| `src/agent/types.ts` | GH02, GH04, GH05, GH10, GH12 | MEDIUM — all additive optional fields |
| `src/agent/tools.ts` | GH06, GH07, GH08, GH09, GH10 | MEDIUM — all adding registrations |
| `src/model/types.ts` | GH03, GH09, GH11 | MEDIUM — type widening + new blocks |
| `src/index.ts` | GH04, GH10, GH12, GH13 | MEDIUM — wiring new deps |

## Review Findings to Address During Implementation

These items from the cross-plan review don't require plan changes but should be handled during implementation:

1. **Mock SecretManagers must be async** — GH14 changes `set()`/`remove()` to `Promise<void>`. All test mocks in GH06, GH10, GH13 need `async set()` / `async remove()`.

2. **`toolResultContentToString` needs `type: 'image'` branch** — When implementing GH09, add `if (block.type === 'image') return '[image]';` to GH03's helper so non-Anthropic providers serialize image blocks correctly.

3. **GH08 `mode: 'both'`** — Verify GH03's 4-arg `registry.register()` exists before using it. If implementing ahead of GH03, use 3-arg with TODO (same pattern as GH06/GH07).

4. **Test file collisions** — Multiple plans create `src/agent/agent.test.ts`. Whichever lands second should add to the existing file, not overwrite it.

5. **Line number references are approximate** — Several plans reference specific line numbers that will drift after earlier merges. Search for described code patterns instead.

6. **Standardize test file locations** — GH06 uses `__tests__/` subdirectory; all others co-locate. Prefer co-located `.test.ts` files (the majority pattern).
