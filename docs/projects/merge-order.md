# Merge Order — 14-Feature Implementation DAG

This document records the merge order used for the 14 feature PRs and serves as a reference for the dependency graph.

## Dependency Graph

```
Wave 0 (independent):     GH14    GH11    GH01
                            │       │       │
                            └───┬───┘───┬───┘
                                │       │
Wave 1 (parallel):        GH03  GH04  GH02  GH12
                           │ │    │ │    │      │
                           │ │    │ │    │      │
Wave 2 (parallel):    GH07 GH06 GH09 GH08 GH05│
                           │         │    │     │
                           │         │    │     │
Wave 3 (sequential):      GH10──────┼────┘     │
                            │        │          │
                           GH13──────┴──────────┘
```

## PRs

| PR | Branch | Feature |
|----|--------|---------|
| #15 | GH14 | Standalone Secrets Management |
| #16 | GH01 | Graceful Max-Iteration Exhaustion |
| #17 | GH11 | Extended Thinking / Reasoning |
| #18 | GH02 | Event Emission / Lifecycle Hooks |
| #19 | GH12 | Dynamic System Prompt Provider |
| #20 | GH04 | Sub-Agent LLM |
| #21 | GH03 | Multi-Tool Architecture |
| #22 | GH06 | Outbound Notification (Discord) |
| #23 | GH05 | Auto-Generated Session Titles |
| #24 | GH08 | Summarization Tool |
| #25 | GH07 | Built-In Web Tools |
| #26 | GH09 | Image Viewing Tool |
| #27 | GH10 | Custom Tool Creation + Approval |
| #28 | GH13 | Multi-Screen TUI |

## Edge List

```
GH14 → (none)
GH11 → (none)
GH01 → (none)
GH03 → GH14, GH11, GH01
GH04 → GH14, GH11, GH01
GH02 → GH14, GH11, GH01
GH12 → GH14, GH11, GH01
GH07 → GH03, GH14
GH06 → GH03, GH14
GH09 → GH03
GH08 → GH03, GH04
GH05 → GH04
GH10 → GH03, GH14
GH13 → GH02, GH05, GH10, GH14
```

## Known Follow-Ups

1. TUI tests — Zero test coverage for 7 new TUI screens
2. SSRF protection — `http_get` has no URL allow-list
3. Delete confirmation — SessionsScreen deletes immediately
4. Provider image asymmetry — `view_image` returns placeholder for non-Anthropic
5. Stale TODO — `notify.ts` has `// TODO(GH03)` for `mode: 'both'`
6. Compaction image branch — `formatConversation` missing `type: 'image'` branch
7. Scheduler persist patterns — Other silent `persist().catch(() => {})` sites
8. Ollama reasoning — Provider doesn't extract `reasoning_content`
9. OpenAI `max_tokens` deprecation — Sub-agent uses deprecated field
