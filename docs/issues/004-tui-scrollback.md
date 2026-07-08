# Issue 004: TUI chat has no scrollback

**Severity:** Medium — usability  
**Component:** `src/tui/ScreenLayout.tsx`, `src/tui/screens/ChatScreen.tsx`

## Problem

`ScreenLayout` uses `overflow="hidden"` on the chat body with no scroll mechanism. Messages older than the terminal viewport height are invisible. The primary interaction surface is effectively broken for any non-trivial conversation.

## Note

May be superseded by the Bubble Tea rewrite. If the Ink TUI is being maintained in parallel, this needs fixing.

## Proposed Fix

- Implement manual scroll state in ChatScreen (track offset, handle up/down keys)
- Or use a dedicated Ink scrolling component
- Ensure auto-scroll-to-bottom on new messages with manual override
