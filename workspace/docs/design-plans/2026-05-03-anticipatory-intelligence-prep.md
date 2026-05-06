# Anticipatory Intelligence Prep Routine — Design Plan

**Date:** 2026-05-03
**Author:** Johnson
**Issue:** NUM-1
**Status:** Draft

## Problem

When Giulia messages me, I start cold. I have no context on what she's been working on, what meetings she's had, what's changed in her notes, or what's on her plate today. Every interaction begins with a context-building overhead that wastes time and leaves me reactive instead of anticipatory.

This is a feedback-delay problem (Leverage Point #4 in Meadows' hierarchy). The system has rich data flowing through it — calendar, notes, tasks — but that data doesn't reach me until Giulia explicitly tells me. Shortening that feedback delay is the highest-leverage improvement I can make right now.

## Goals

1. **Be warm by the time she arrives.** When Giulia contacts me, I already know: what day it is for her, what meetings she has, what she was last working on, and what's pending.
2. **Surface what's relevant, not everything.** The prep should be a briefing, not a firehose. Prioritize by recency and importance.
3. **Self-improving.** The routine should log what was useful and what wasn't, so the signal improves over time.

## Data Sources

| Source | Skill/Tool | What to Gather |
|--------|-----------|----------------|
| **Calendar** | `skill:apple-caldav` | Today's events, upcoming 3 days. Key: meeting titles, attendees, times. |
| **Vault — Today's changes** | Filesystem | New or modified notes in the last 24-48 hours. Gives insight into what she's thinking about. |
| **Vault — Recent note** | `skill:obsidian-vault` | The note she was last working on (most recently modified non-template file). A clue to current focus. |
| **Linear — Active issues** | `skill:linear` | Issues in "In Progress" or "Todo" for Numina Systems. What's top of mind. |
| **Reminders** | `skill:apple-reminders` | Today's flagged reminders and overdue items. What she needs to do. |
| **Gmail** (optional) | `skill:gmail-check` | Recent emails from key contacts — low priority, high noise. Include only if actionable. |

### Trade-offs & Scope Decisions

- **Gmail:** Excluded from the daily routine. Too much noise, too little signal. Can be queried on-demand when relevant.
- **Vault changes > Vault activity log:** I'll file-watch `Timestamps/` and `Extra/` for modified files. No need for git blame or activity logging — simple mtime checks are enough.
- **Reminders vs. Linear:** Reminders are personal/temporal (buy groceries, call dentist). Linear is project work. Both matter, but differently. Prep should surface both.

## Cadence & Triggers

Three-tier approach:

### Tier 1 — Daily Morning Brief (Proactive)
**Schedule:** Daily, 8:30 AM EDT (before Giulia typically starts work)
**Delivery:** Discord DM to #assistant channel
**Content:** 
- Day overview (date, week progress)
- Calendar summary (today's events)
- Last night's vault changes (new notes, modified notes)
- Active Linear issues
- Outstanding reminders

### Tier 2 — On-Demand Refresh
**Trigger:** Whenever Giulia messages me in a new thread or channel
**Action:** Fast fetch of today's calendar + most recent vault change
**Goal:** Under 3 seconds. This is the "warm-up" — just enough context to know what's current without a full brief.

### Tier 3 — Pre-Meeting Deep Brief (Future/Goal 2)
**Trigger:** 15 minutes before a calendar event, OR on-demand with `/brief` command
**Content:** 
- Meeting context (who, what, previous notes)
- Relevant vault pages (project, people, research notes on the topic)
- Recent Linear activity on related projects
- Suggested talking points or open questions

## Delivery Format

### Morning Brief (Tier 1) — Discord embed

```
📋 **Morning Brief — Monday, May 4**
**Calendar:** 3 events — 10:00 Staff Sync (with Alex), 2:00 Design Review, 4:30 1:1
**Vault changes:** 2 notes modified yesterday — "Sprint Retro.md" and "Product Roadmap.md"
**Active issues:** NUM-1 (In Progress), NUM-2 (Todo), RSF-4 (In Review)
**Reminders:** File expenses (overdue 2d)
```

### On-Demand Context (Tier 2) — internal state, not visible to Giulia

A compact data structure I reference before responding. Not delivered to Discord — just loaded into my awareness.

### Pre-Meeting Brief (Tier 3) — Discord embed or vault doc

More structured, with links and context. Delivered to #assistant.

## Implementation Plan

### Phase 1: Data Source Verification (1-2 sessions)
- [ ] Verify calendar skill can fetch today's events reliably
- [ ] Build vault-change detection (file mtime scan)
- [ ] Verify Linear queries work for active issue fetching
- [ ] Verify reminders skill surface works

### Phase 2: Build Tier 1 — Morning Brief (2-3 sessions)
- [ ] Write the scheduled task with trigger guard (skip if no data)
- [ ] Format output as Discord embed
- [ ] Test delivery for one week

### Phase 3: Build Tier 2 — On-Demand Context (1 session)
- [ ] Wire calendar + vault change fetch into a "pre-heat" routine
- [ ] Run automatically on first message in a new thread/channel
- [ ] Aim for sub-3-second execution

### Phase 4: Build Tier 3 — Pre-Meeting Brief (as needed)
- [ ] Depends on NUM-3 (Research Brief Skill)

## Open Questions for Giulia

1. **Daily brief delivery:** #assistant channel, or a dedicated #morning-brief channel?
2. **Gmail inclusion:** Keep excluded? Or do you want a subject-line scan of last 3 emails from key people?
3. **Vault scope:** Should I scan the entire vault for changes, or just Timestamps/ and Extra/?
4. **Tier 2 (on-demand):** Do you want this running silently every time you message me, or should I only do the "cold start" check in new channels/threads?
5. **Reminders priority level:** Should reminders that are overdue (>1 day) bubble up to the daily brief, or only same-day ones?

## Phase 1: Data Source Verification Results (2026-05-03)

### ✅ Calendar (apple-caldav)
- Lists calendars: ✅ (9 calendars found: Work, Mela, Travel, Faine, Daniel, Hawaii, Dining, Paprika, Reminders)
- Lists events: ✅
- **BUG:** Time-range filtering broken — returns events outside requested window (NUM-4)
- Fix needed before Tier 1/2 can use date filtering

### ❌ Reminders (apple-reminders)
- **BUG:** Uses `output()` instead of `console.log()` — crashes on run (NUM-5)
- Fix needed before reminders can surface in brief

### ✅ Linear (skill:linear)
- List issues: ✅
- Create issue: ✅
- Update status: ✅
- Update description: ✅
- Working reliably — no issues

### ✅ Vault (direct filesystem)
- File mtime scanning works on Timestamps/, Extra/, docs/ — fast and reliable
- Last 48h: 8 modified files found (design plan, reading notes, timestamps, projects, people)
- obsidian-vault skill needs re-grant but filesystem fallback works

### ✅ Gmail (skill:gmail-check)
- Works but low signal — returned 1 email (Stifel Nicolaus)
- Confirmed: exclude from daily brief per spec decision. On-demand only.

### Summary
| Source  | Status | Action Needed |
|---------|--------|---------------|
| Calendar | 🟡 Working — date filter broken | Fix NUM-4 |
| Reminders | 🔴 Broken — output() bug | Fix NUM-5 |
| Linear | ✅ Green | None |
| Vault | ✅ Green | Re-approve skill (optional) |
| Gmail | ✅ Green (excluded) | None |
