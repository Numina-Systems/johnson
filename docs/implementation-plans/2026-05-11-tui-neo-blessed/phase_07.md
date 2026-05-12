# TUI Neo-Blessed Migration — Phase 7: Chat Search & Polish

**Goal:** Add search overlay to chat history, implement tab activity indicators, and polish UX across all views (focus management, resize handling, edge cases).

**Architecture:** Search is an overlay box inside the chat view triggered by F5, using string matching against message content. Activity indicators are managed by the tab bar via the event bus — views emit `tab:activity` when updated while not visible, and the tab bar clears the indicator when that tab is visited. Polish work addresses edge cases across all views.

**Tech Stack:** neo-blessed, @types/blessed, TypeScript, Bun

**Scope:** 8 phases from original design (phase 7 of 8)

**Codebase verified:** 2026-05-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui-neo-blessed.AC4: Tab bar navigation
- **tui-neo-blessed.AC4.2 Success:** Tab/Shift+Tab cycles between tabs in order, wrapping at ends

### tui-neo-blessed.AC9: New features
- **tui-neo-blessed.AC9.2 Success:** F5 opens search overlay in chat that matches text and scrolls to first result

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add search overlay to chat view

**Verifies:** tui-neo-blessed.AC9.2

**Files:**
- Modify: `src/tui/views/chat.ts`

**Implementation:**

Add a search overlay to the chat view. The search is triggered by F5 and dismissed by Escape.

1. **Search overlay widget:** Create a `blessed.box` positioned at the top of the message history area:
   - `top: 0, left: 0, width: '100%', height: 3`
   - Contains a `blessed.textbox` for search input (single line)
   - Hidden by default
   - Tags enabled for result count display
   - Border with label "Search"

2. **Search state:**
   - `searchVisible: boolean`
   - `searchQuery: string`
   - `matchIndices: Array<number>` — indices into the messages array that match
   - `currentMatchIdx: number` — which match is currently focused

3. **F5 key binding** (on the container, not textarea):
   - If search is hidden: show search overlay, focus the search textbox, set `searchVisible = true`
   - If search is visible: close search

4. **Search input handling:**
   - On each keystroke/change in the search textbox: run string match against `messages` array
   - Match: case-insensitive `message.text.includes(query.toLowerCase())`
   - Update `matchIndices` with indices of matching messages
   - Show match count in the overlay: `"N matches"` or `"No matches"`
   - If matches exist, scroll the history viewer to the first match position
   - Enter in search box: jump to next match (cycle through `matchIndices`)

5. **Escape in search mode:** Clear search, hide overlay, return focus to textarea. Restore normal scroll position.

6. **Visual indication:** The search overlay box should use `blessedStyles.accent` for the border to make it visually distinct.

**Extract as pure function (Functional Core):**

```typescript
function findMatches(
  messages: ReadonlyArray<{ text: string }>,
  query: string,
): Array<number> {
  if (!query) return [];
  const lower = query.toLowerCase();
  return messages.reduce<Array<number>>((acc, msg, idx) => {
    if (msg.text.toLowerCase().includes(lower)) acc.push(idx);
    return acc;
  }, []);
}
```

**Testing:**

Tests must verify:
- tui-neo-blessed.AC9.2: `findMatches()` returns correct indices for case-insensitive string matching; empty query returns empty; no matches returns empty

Test `findMatches()` as a pure function:
- Matches multiple messages
- Case-insensitive matching
- Empty query returns no matches
- No matching text returns empty array

Test file: `src/tui/views/chat.test.ts` (add to existing test file from Phase 4)

**Verification:**

Run: `bun test src/tui/views/chat.test.ts`
Expected: All tests pass (including Phase 4 tests)

**Commit:** `feat(tui): add F5 search overlay to chat view`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement tab activity indicators

**Verifies:** tui-neo-blessed.AC4.2

**Files:**
- Modify: `src/tui/tab-bar.ts`
- Modify: `src/tui/index.ts`
- Modify: `src/tui/views/chat.ts`

**Implementation:**

The tab bar already has `setActivity(tabName, hasActivity)` from Phase 1 that appends `*` to tab labels. Now wire it up:

1. **In `index.ts`** — when switching tabs, clear the activity indicator for the newly active tab:
   ```typescript
   function switchTab(newIndex: number) {
     // ... existing hide/show logic ...
     tabBar.setActivity(labels[newIndex], false);
   }
   ```

2. **In `chat.ts`** — when a new message arrives (agent response completes) and the Chat tab is NOT currently visible, emit `tab:activity` on the bus:
   ```typescript
   bus.emit('tab:activity', { tab: 'Chat' });
   ```

3. **In `index.ts`** — listen for `tab:activity` events on the bus and update the tab bar:
   ```typescript
   bus.on('tab:activity', (data: { tab: string }) => {
     // Only show activity if this tab is not the active one
     if (labels[activeTabIndex] !== data.tab) {
       tabBar.setActivity(data.tab, true);
       screen.render();
     }
   });
   ```

4. **In `sessions.ts`** (if desired) — when session list changes while Sessions tab is not visible, emit activity. This is optional but improves UX.

5. **Verify Tab/Shift+Tab wrapping** — ensure that Tab at the last tab (Prune, index 6) wraps to Sessions (index 0), and Shift+Tab at Sessions wraps to Prune. This should already work from Phase 1 but verify.

**Testing:**

Tests must verify:
- tui-neo-blessed.AC4.2: Tab wrapping works in both directions (Tab wraps forward, Shift+Tab wraps backward)
- Activity indicator lifecycle: set when event fires for non-active tab, cleared when tab is visited

Test tab wrapping logic as pure function:
```typescript
function nextTab(current: number, total: number): number {
  return (current + 1) % total;
}
function prevTab(current: number, total: number): number {
  return (current - 1 + total) % total;
}
```

Test activity indicator logic:
- Activity set for non-active tab → indicator appears
- Switching to that tab → indicator clears
- Activity for active tab → no indicator shown

Test file: `src/tui/tab-bar.test.ts`

**Verification:**

Run: `bun test src/tui/tab-bar.test.ts`
Expected: All tests pass

**Commit:** `feat(tui): wire tab activity indicators and verify tab wrapping`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Polish — edge cases, focus management, resize

**Files:**
- Modify: `src/tui/index.ts`
- Modify: `src/tui/views/sessions.ts`
- Modify: `src/tui/views/chat.ts`
- Modify: Various view files as needed

**Implementation:**

Address UX polish across all views:

1. **Empty state handling:**
   - Sessions view: show "No sessions. Press 'n' to create one." when session list is empty
   - Chat view: show "Select a session to start chatting" when no session is selected
   - Tools view: show "No custom tools" / "No skills" when sections are empty
   - Secrets view: show "No secrets. Press 'a' to add one." when empty
   - Schedules view: show "No scheduled tasks" when empty
   - Prune view: show "No sessions to prune" when empty

2. **Resize handling:**
   - Listen for `screen.on('resize')` in `index.ts`
   - On resize: call `screen.render()` to reflow all elements
   - Blessed handles percentage-based sizing automatically, but fixed-height elements may need recalculation

3. **Focus management:**
   - When switching tabs, call `focus()` on the new active view
   - When Escape returns from a sub-mode (code viewer, confirmation), refocus the appropriate element
   - Ensure textarea in Chat view always receives focus when Chat tab is shown

4. **Long message handling:**
   - Verify that long messages wrap correctly in the ScrollableViewer (blessed does word wrap with `tags: true`)
   - Test with messages exceeding viewport width

5. **Edge case: session deleted while viewing chat:**
   - If the active session is deleted (from another tab or by prune), Chat view should show an appropriate message and not crash

**Testing:**

Test empty state strings are set when lists have zero items. Test resize doesn't throw. These are primarily integration/operational tests.

Test file: Add edge case tests to existing test files where appropriate.

**Verification:**

Run: `bun test src/tui/`
Expected: All TUI tests pass

Run: `bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "fix(tui): handle edge cases — empty states, resize, focus management"
```
<!-- END_TASK_3 -->
