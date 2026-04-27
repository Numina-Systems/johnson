# GH05: Auto-Generated Session Titles — Test Requirements

## Automated Tests

All tests live in `src/agent/session-title.test.ts`.

| AC ID | Criterion | Test Type | Test Description |
|-------|-----------|-----------|------------------|
| GH05.AC1.1 | Guards: sub-agent, session title, user messages | Unit | Three separate tests: (1) undefined sub-agent returns without calling store, (2) undefined sessionId returns without calling store, (3) all guards pass -> proceeds to generation |
| GH05.AC2.1 | Sub-agent called with first 10 messages | Unit | Provide 15 messages, capture the prompt passed to sub-agent, verify it contains only the first 10, each truncated to 200 chars |
| GH05.AC3.1 | Post-processing: quotes, punctuation, first line, 80 chars | Unit | Direct tests of `postProcessTitle`: strip double quotes, strip single quotes, strip trailing `.!?`, take first line of multi-line, truncate at 80 chars, combined cases |
| GH05.AC4.1 | Title persisted via store.updateSessionTitle | Unit | Mock store, verify `updateSessionTitle` called with correct session ID and processed title |
| GH05.AC5.1 | Non-blocking, errors swallowed | Unit | Sub-agent that throws -> verify the returned promise rejects (caller uses `.catch(() => {})`) |
| GH05.AC6.1 | sessionId on ChatOptions | Compile | TypeScript compiler verifies the type exists and is assignable; Discord bot passes it |
| GH05.AC7.1 | Happy path: mock sub-agent returns title -> store updated | Unit | Full flow: 2+ user messages, no existing title, sub-agent returns title, verify store.updateSessionTitle called |
| GH05.AC8.1 | Session already has title -> sub-agent not called | Unit | Mock store.getSession returns `{ title: "Existing" }`, verify sub-agent.complete never called |
| GH05.AC9.1 | Fewer than 2 user messages -> sub-agent not called | Unit | Provide 1 user message + 1 assistant message, verify sub-agent.complete never called |

## Human Verification

| AC ID | Criterion | Why Not Automated | Verification Approach |
|-------|-----------|-------------------|----------------------|
| GH05.AC5.1 (integration) | Fire-and-forget doesn't block response | Timing behavior in real agent loop hard to assert in unit tests | Run agent with sub-agent configured, verify response returns before title generation completes (observable via stderr logs or store inspection) |

## Mock Strategy

- **Store:** Partial mock implementing only `getSession` and `updateSessionTitle`. Use a simple object with jest-compatible spy functions (`mock()` from Bun test runner).
- **SubAgentLLM:** Object with `complete` as a mock function returning a configurable string.
- **Messages:** Array of `Message` objects with `role` and `content` fields. No need for full content block arrays in most tests -- string content suffices.
