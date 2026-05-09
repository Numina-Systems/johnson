# Test Requirements: Bubbletea TUI

## Automated Tests

### AC1: JSON-RPC protocol covers all TUI features

---

#### AC1.1: Backend starts in jsonrpc mode, emits `ready` notification

- **Test type:** Unit
- **Test file:** `src/jsonrpc/server.test.ts`
- **What to verify:**
  - Calling `startJsonRpcServer()` writes a `ready` notification to stdout as its first line
  - The notification has shape `{ jsonrpc: "2.0", method: "ready", params: { protocolVersion: "1", capabilities: [...] } }`
  - `protocolVersion` is the string `"1"`
  - `capabilities` array contains all expected values: `sessions`, `chat`, `secrets`, `skills`, `customTools`, `schedules`, `prompt`
- **Implementation notes:** Capture stdout via a writable stream mock. Parse the first line as JSON and assert shape. No need to spawn a real process.

---

#### AC1.2: All 21 request methods return well-formed responses

- **Test type:** Unit
- **Test file:** `src/jsonrpc/handlers.test.ts`
- **What to verify (one test per handler group):**
  - **Session handlers (4):** `session/list`, `session/create`, `session/delete`, `session/messages` each return correctly shaped results when given valid params. Mock `Store` with `listSessionsPaginated`, `createSession`, `deleteSession`, `getMessagesPaginated`.
  - **Chat handlers (2):** `agent/chat` returns `{ requestId: <uuid> }`. `agent/reset` returns `{ ok: true }`. Mock `Agent` with controllable `chat()` and `reset()`.
  - **Skill handlers (4):** `skill/list`, `skill/grant`, `skill/updateSecrets`, `skill/delete` return expected shapes. Mock `Store` with `docList`, `getGrant`, `updateGrantStatus`, `updateGrantSecrets`, `docDelete`, `deleteGrant`.
  - **Custom tool handlers (4):** `customTool/list`, `customTool/approve`, `customTool/revoke`, `customTool/updateSecrets` return expected shapes. Mock `CustomToolManager`.
  - **Grant handler (1):** `grant/list` returns `{ grants: [...] }`. Mock `Store.listGrants()`.
  - **Secret handlers (3):** `secret/list`, `secret/set`, `secret/remove` return expected shapes. Mock `SecretManager`.
  - **Schedule handlers (2):** `schedule/list`, `schedule/setEnabled` return expected shapes. Mock `TaskStore`.
  - **Prompt handler (1):** `prompt/get` returns `{ prompt: <string> }`. Mock `buildPrompt` closure.
  - **Builtin handler (1):** `builtin/list` returns `{ tools: [...] }` from the static list passed via deps.
- **Implementation notes:** Each handler is tested by calling it directly with mock dependencies. Verify return type shape matches the protocol types defined in `src/jsonrpc/types.ts`.

---

#### AC1.3: `agent/chat` returns requestId, streams events, sends response

- **Test type:** Integration
- **Test file:** `src/jsonrpc/handlers.test.ts`
- **What to verify:**
  - Handler returns `{ requestId }` immediately (before agent.chat resolves)
  - The `onEvent` callback fires `sendAgentEvent()` for each event emitted by the agent (mock agent emits `llm_start`, `tool_start`, `tool_done`, `llm_done`)
  - When `agent.chat()` resolves, `sendAgentResponse()` is called with the requestId, response text, and stats
  - When `agent.chat()` rejects, `sendAgentResponse()` is called with error text and zeroed stats
- **Implementation notes:** Mock `Agent.chat()` to resolve after a delay, firing events via the `onEvent` callback. Spy on `sendAgentEvent` and `sendAgentResponse` from `notifications.ts`. Verify ordering: requestId returned first, events in order, response last.

---

#### AC1.4: `session/messages` supports cursor-based pagination

- **Test type:** Unit
- **Test file:** `src/store/pagination.test.ts`
- **What to verify:**
  - `listSessionsPaginated(limit)` returns `cursor` when more sessions exist, no cursor when at end
  - `getMessagesPaginated(sessionId, limit)` returns `cursor` when more messages exist, no cursor when at end
  - Empty results return empty array and no cursor
  - Cursor from first page produces correct second page when passed back
  - Pagination uses keyset pattern (not offset) so inserts between pages do not cause skips or duplicates
- **Implementation notes:** Create temp SQLite database, insert known rows, test pagination across pages. Follow existing `bun:test` patterns in the project. The Store already has `docList()` with keyset pagination as a reference pattern.

---

#### AC1.5: Malformed JSON-RPC returns -32600

- **Test type:** Unit
- **Test file:** `src/jsonrpc/server.test.ts`
- **What to verify:**
  - Sending `{"jsonrpc":"2.0"}` (missing `method` and `id`) produces response with `error.code === -32600` and `error.message === "Invalid Request"`
  - Sending `{"not":"jsonrpc"}` produces the same error
  - Sending `{"jsonrpc":"2.0","method":"foo"}` (missing `id`, making it look like a notification but to an unknown method) produces `-32600`
- **Implementation notes:** Feed lines into the server's readline handler via a mock stdin stream. Capture stdout responses.

---

#### AC1.6: Unknown method returns -32601

- **Test type:** Unit
- **Test file:** `src/jsonrpc/server.test.ts`
- **What to verify:**
  - Sending `{"jsonrpc":"2.0","method":"nonexistent/method","id":1}` produces response with `error.code === -32601` and `error.message` containing `"Method not found"`
- **Implementation notes:** Same approach as AC1.5 — mock stdin, capture stdout.

---

#### AC1.7: Only JSON-RPC on stdout in jsonrpc mode

- **Test type:** Unit
- **Test file:** `src/jsonrpc/stdout-discipline.test.ts`
- **What to verify:**
  - After calling `enforceStdoutDiscipline()`, `console.log()` writes to stderr (not stdout)
  - Same for `console.info()`, `console.warn()`, `console.debug()`
  - `process.stdout.write()` is NOT intercepted (documenting the known limitation)
- **Implementation notes:** Mock `process.stderr.write`, call each console method, verify the mock received the output. Verify `process.stdout.write` is unchanged by checking its identity.

---

### AC2: Go TUI implements all screens with hybrid layout

---

#### AC2.2: Chat viewport scrolls with j/k or arrows

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/chat_test.go`
- **What to verify:**
  - Sending `KeyMsg("j")` to ChatModel increases the viewport's vertical offset
  - Sending `KeyMsg("k")` decreases the viewport's vertical offset
  - Arrow up/down produce the same effect
  - Viewport offset clamps at 0 (top) and max content height (bottom)
- **Implementation notes:** Create a ChatModel with pre-populated messages exceeding viewport height. Send key messages via `Update()` and inspect the viewport model's `YOffset` after each.

---

#### AC2.5: Sessions screen lists sessions with message counts, create/delete

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/sessions_test.go`
- **What to verify:**
  - `sessionsLoadedMsg` with session data populates the list items with correct titles and descriptions (including message count)
  - Pressing `n` returns a `tea.Cmd` (the create command)
  - Pressing `d` with an item selected returns a `tea.Cmd` (the delete command)
  - Pressing `Enter` with an item selected returns a `NavigateToChatMsg` with the correct session ID
- **Implementation notes:** Use a mock protocol client or test only the model's `Update()` return values without making real RPC calls.

---

#### AC2.6: Tools screen tabbed view, grant/revoke/secret assignment

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/tools_test.go`
- **What to verify:**
  - `Tab` key cycles `activeTab` through 0, 1, 2 (Skills, Custom Tools, Builtins)
  - `Shift+Tab` cycles in reverse
  - On Skills tab, pressing `g` on a selected item returns a grant command
  - On Skills tab, pressing `r` on a selected item returns a revoke command
  - On Skills tab, pressing `d` returns a delete command
  - On Skills tab, pressing `s` transitions to `toolsModeEditSecrets`
  - On Custom Tools tab, pressing `a` returns an approve command
  - On Builtins tab, action keys (`g`, `r`, `d`, `s`, `a`) are no-ops
  - `Escape` in `toolsModeEditSecrets` returns to `toolsModeList`
- **Implementation notes:** Test model state transitions via `Update()`. No real RPC calls needed.

---

#### AC2.7: Secrets screen lists names, add/remove

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/secrets_test.go`
- **What to verify:**
  - Loading secrets populates the key list
  - View output contains key names but never values
  - Pressing `a` transitions to `secretsModeAddName`
  - Completing the add flow (name Enter, value Enter) returns to list mode and issues a set command
  - Pressing `d` on a selected key issues a remove command
- **Implementation notes:** Test model state transitions. The "never shows values" check can assert that the View() output does not contain any mock value strings.

---

#### AC2.8: Schedules screen with run counts, enable/disable

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/schedules_test.go`
- **What to verify:**
  - Loading tasks populates the list with name, schedule, enabled badge, run count, last run info
  - View output includes run count and last run timestamp for tasks that have run
  - View output shows "Never" for tasks that have not run
  - Pressing `e` toggles enabled state and issues a setEnabled command
- **Implementation notes:** Construct model with mock `TaskStateInfo` data. Inspect `View()` output for expected strings.

---

#### AC2.9: Prompt screen with scrollable viewport

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/prompt_test.go`
- **What to verify:**
  - Loading prompt content sets the viewport content and marks `ready = true`
  - View shows "Loading..." when `ready` is false
  - Scrolling keys (j/k, PgUp/PgDn) change viewport offset
  - `Escape` returns a navigation message
- **Implementation notes:** Create model, send prompt loaded message, verify viewport content matches.

---

#### AC2.10: Screen navigation via ctrl+ keybindings and escape

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/app/app_test.go`
- **What to verify:**
  - `ctrl+t` pushes `ScreenTools` onto the stack and sets it active
  - `ctrl+s` pushes `ScreenSecrets`
  - `ctrl+d` pushes `ScreenSchedules`
  - `ctrl+p` pushes `ScreenPrompt`
  - `Escape` pops the stack and returns to the previous screen
  - `Escape` on the root screen (stack length 1) is a no-op
  - `ctrl+c` returns `tea.Quit`
  - Screen stack maintains correct history through push/pop sequences
- **Implementation notes:** Create AppModel with a mock client. Send key messages and assert `activeScreen` and `screenStack` state after each.

---

#### AC2.11: Scroll-up triggers pagination

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/screens/chat_test.go`
- **What to verify:**
  - When viewport offset is 0 (at top) and a scroll-up key is pressed with a non-empty `messageCursor`, a pagination command is returned
  - When viewport offset is 0 and `messageCursor` is empty, no pagination command is returned
  - After `loadOlderMsg` is received, older messages are prepended and the viewport scroll position is adjusted so the previously-visible content does not jump
- **Implementation notes:** Set viewport offset to 0 manually, set a cursor, send scroll-up. Verify the returned `tea.Cmd` is non-nil. Then simulate the response and check message order.

---

### AC3: TS backend exposes services over protocol

---

#### AC3.1: JSON-RPC translates to existing service calls

- **Test type:** Unit
- **Test file:** `src/jsonrpc/handlers.test.ts`
- **What to verify:**
  - Each handler calls the correct method on the correct service (Store, SecretManager, Scheduler, CustomToolManager)
  - No business logic is duplicated — handlers are pure pass-through wiring
  - `skill/list` filters documents by `skill:` prefix and enriches with grant data from `store.getGrant()`
  - `skill/delete` calls both `store.docDelete()` AND `store.deleteGrant()` (both are required)
  - `secret/set` calls `secrets.set()` (async) and awaits it
- **Implementation notes:** Use spies/mocks on each dependency. Verify the exact methods called and arguments passed. This is covered by the same test file as AC1.2 but with assertion focus on delegation correctness rather than response shape.

---

#### AC3.2: `agent/chat` wires onEvent to notifications

- **Test type:** Unit
- **Test file:** `src/jsonrpc/handlers.test.ts`
- **What to verify:**
  - The `agent/chat` handler passes an `onEvent` callback to `agent.chat()`
  - Each event kind (`llm_start`, `llm_done`, `tool_start`, `tool_done`, `recall_done`) produces a corresponding `sendAgentEvent()` notification with the correct `requestId`
  - The final response produces a `sendAgentResponse()` notification
  - Event `data` payloads are forwarded without modification
- **Implementation notes:** Same integration test as AC1.3, with assertion focus on the notification emission path. Spy on the notification functions.

---

#### AC3.3: Backend crash sends signal that TUI detects and shows recovery UI

- **Test type:** Integration (Go)
- **Test file:** `tui/internal/app/app_test.go`
- **What to verify:**
  - Sending a `backendCrashedMsg` to the AppModel sets `crashed = true` and stores the error message
  - While `crashed`, the View output contains "Backend process exited unexpectedly" and the error message
  - While `crashed`, pressing `r` triggers a restart sequence (returns a restart command)
  - While `crashed`, pressing `q` returns `tea.Quit`
  - While `crashed`, normal navigation keys (ctrl+t, etc.) are no-ops
- **Implementation notes:** Test the model's crash state directly by sending `backendCrashedMsg`. The actual process crash detection (`WaitExit` channel) is tested separately.

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/backend/process_test.go`
- **What to verify:**
  - `Shutdown()` sends SIGTERM to the child process
  - `Shutdown()` sends SIGKILL after timeout if process doesn't exit
  - `WaitExit()` channel receives the exit error when the process terminates
  - `Restart()` kills the old process and starts a new one
- **Implementation notes:** Spawn a trivial subprocess (e.g., `sleep 60`) to test lifecycle management without needing the real backend.

---

#### AC3.4: Concurrent requests handled correctly

- **Test type:** Integration
- **Test file:** `src/jsonrpc/handlers.test.ts`
- **What to verify:**
  - Send `agent/chat` (mock agent delays 100ms), then immediately send `secret/list`
  - `secret/list` response arrives before `agent/response` notification
  - Both responses are well-formed and reference correct IDs
  - No response interleaving or corruption occurs
- **Implementation notes:** Use the JSON-RPC server with two mock handlers. Send both requests on the same stdin stream. Parse stdout responses and verify ordering.

---

### AC4: Discord-only mode works independently

---

#### AC4.1: `bun start --interface discord` works without Go TUI

- **Test type:** Unit
- **Test file:** `src/config/loader.test.ts`
- **What to verify:**
  - `--interface discord` CLI argument overrides the config.toml value
  - The parsed config has `interface === 'discord'`
- **Implementation notes:** Test the `parseInterfaceFromArgv()` helper with mocked `process.argv`. Existing test file at `src/config/loader.test.ts` can be extended.

---

#### AC4.2: `constellation-tui --with-discord` starts both

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/backend/process_test.go`
- **What to verify:**
  - When `withDiscord` is true, `BackendProcess.Start()` passes `--interface both` to the child process command
  - When `withDiscord` is false, it passes `--interface jsonrpc`
- **Implementation notes:** Inspect the constructed `exec.Cmd.Args` slice. No need to actually spawn the process.

---

#### AC4.3: TUI exit cleanly shuts down backend via SIGTERM

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/backend/process_test.go`
- **What to verify:**
  - `Shutdown(timeout)` sends SIGTERM to the child process
  - If the child exits within timeout, `Shutdown` returns without SIGKILL
  - If the child does not exit within timeout, `Shutdown` sends SIGKILL
  - After shutdown, the exit channel is closed
- **Implementation notes:** Spawn `sleep 60` as a subprocess. Call `Shutdown(100ms)` and verify the process is terminated.

---

### Cross-Cutting Tests

---

#### Protocol types round-trip (Go <-> TS)

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/protocol/types_test.go`
- **What to verify:**
  - Go structs marshal to JSON matching the TS type definitions (spot-check key types: `SessionListResult`, `AgentEventParams`, `SkillInfo`, `TaskStateInfo`)
  - Go structs unmarshal correctly from JSON matching the TS output format
  - Optional fields (`omitempty`) are excluded when zero-valued
  - Nil pointer fields (e.g., `*string` for nullable title) serialize as `null`

---

#### Layout computation (Go)

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/layout/split_test.go`
- **What to verify:**
  - `ComputeChatLayout` allocates correct heights for header, status, input, viewport at various terminal sizes
  - Viewport height is always at least 3 lines
  - Input height caps at 4 lines regardless of input lines
  - All heights sum to `totalHeight`

---

#### Message rendering (Go)

- **Test type:** Unit (Go)
- **Test file:** `tui/internal/render/messages_test.go`
- **What to verify:**
  - `RenderUserMessage` output starts with styled "you>" prefix and includes the content
  - `RenderAgentMessage` with markdown input produces glamour-rendered output
  - `RenderAgentMessage` falls back to plain text when glamour fails
  - `SetWidth` updates the word-wrap width for subsequent renders

---

## Human Verification

---

#### AC2.1: Sub-16ms keystroke lag

- **Why it cannot be automated:** Keystroke latency is a perceptual performance metric that depends on terminal emulator rendering, system load, and the full bubbletea render pipeline.
- **Verification approach:**
  1. Build and run: `just build && bin/constellation-tui`
  2. Navigate to chat screen
  3. Type rapidly — characters should appear instantly with no visible delay or stutter
  4. Monitor CPU usage — Go process should be near 0% between keystrokes
  5. Compare subjective typing feel against the existing Ink TUI

---

#### AC2.3: Status pane updates in real-time

- **Why it cannot be automated:** While the notification dispatch path is testable (AC3.2), the "real-time" perception depends on the full pipeline: backend event emission, JSON-RPC transport, Go channel forwarding, and bubbletea re-render.
- **Verification approach:**
  1. Start TUI and enter a chat session
  2. Send a message triggering multi-round agent processing
  3. Observe status pane transitions: "Thinking..." -> "Running code..." -> "Round N complete"
  4. Updates should appear within ~100ms of backend emission

---

#### AC2.4: Agent responses render as formatted markdown

- **Why it cannot be automated:** Glamour rendering produces ANSI-styled terminal output whose exact byte sequence depends on terminal capabilities.
- **Verification approach:**
  1. Ask the agent a question producing markdown-rich output
  2. Verify: code blocks have background, bold text is bold, lists are indented, links are distinct
  3. Scroll through output — formatting should be consistent

---

#### AC3.3: Backend crash recovery UI (end-to-end)

- **Why it cannot be automated:** The full recovery flow (process crash detection, UI display, restart, reconnection) requires actual process management.
- **Verification approach:**
  1. Start TUI, find backend PID, `kill <pid>`
  2. Verify crash screen appears with error message
  3. Press `r` — verify restart and return to normal operation
  4. Navigate screens and send chat to confirm full functionality

---

#### AC4.2: `--with-discord` starts both (end-to-end)

- **Why it cannot be automated:** Verifying Discord bot is online requires valid credentials and network access.
- **Verification approach:**
  1. Run: `bin/constellation-tui --with-discord`
  2. Verify TUI launches and Discord bot appears online
  3. `ctrl+c` — verify both exit

---

#### AC4.3: TUI exit cleanly shuts down backend (end-to-end)

- **Why it cannot be automated:** Confirming no orphan processes remain requires checking the process table live.
- **Verification approach:**
  1. Start TUI, note backend PID
  2. `ctrl+c` to quit
  3. Verify PID no longer exists: `ps -p <pid>`
  4. Edge case: quit during active chat — backend should still shut down within 5 seconds

---

## Summary

| Category | Count |
|----------|-------|
| TS unit tests (`bun:test`) | 18 |
| Go unit tests (`go test`) | 16 |
| TS integration tests (`bun:test`) | 2 |
| Go integration tests (`go test`) | 1 |
| Human verification items | 6 |

### Test File Index

| File | Language | ACs Covered |
|------|----------|-------------|
| `src/jsonrpc/server.test.ts` | TS | AC1.1, AC1.5, AC1.6 |
| `src/jsonrpc/handlers.test.ts` | TS | AC1.2, AC1.3, AC3.1, AC3.2, AC3.4 |
| `src/jsonrpc/stdout-discipline.test.ts` | TS | AC1.7 |
| `src/store/pagination.test.ts` | TS | AC1.4 |
| `src/config/loader.test.ts` | TS | AC4.1, AC4.2 |
| `tui/internal/screens/chat_test.go` | Go | AC2.2, AC2.11 |
| `tui/internal/screens/sessions_test.go` | Go | AC2.5 |
| `tui/internal/screens/tools_test.go` | Go | AC2.6 |
| `tui/internal/screens/secrets_test.go` | Go | AC2.7 |
| `tui/internal/screens/schedules_test.go` | Go | AC2.8 |
| `tui/internal/screens/prompt_test.go` | Go | AC2.9 |
| `tui/internal/app/app_test.go` | Go | AC2.10, AC3.3 |
| `tui/internal/backend/process_test.go` | Go | AC3.3, AC4.2, AC4.3 |
| `tui/internal/protocol/types_test.go` | Go | Cross-cutting |
| `tui/internal/layout/split_test.go` | Go | Cross-cutting |
| `tui/internal/render/messages_test.go` | Go | Cross-cutting |
