# Email

Last verified: 2026-03-02

## Purpose
Provides agent-initiated email sending via Mailgun with a recipient allowlist, so the agent can send emails only to pre-approved addresses.

## Contracts
- **Exposes**: `createMailgunSender(options) -> SendEmailFn`, `createEmailTools(options) -> Tool[]`, types `SendResult`, `SendEmailFn`
- **Guarantees**: Emails are only sent to addresses in `allowedRecipients`. The `send_email` tool rejects unlisted recipients before calling the sender. `SendResult` is a discriminated union (`success: true` with `messageId`, or `success: false` with `error`). Sender errors are caught and returned as `SendResult`, never thrown.
- **Expects**: Valid Mailgun API key, domain, and from address. At least one allowed recipient configured.

## Dependencies
- **Uses**: `mailgun.js`, `@/tool/types.ts` (Tool interface)
- **Used by**: `src/index.ts` (composition root, conditional registration when `config.email` is present)
- **Boundary**: No database access. No direct LLM interaction. Stateless.

## Key Decisions
- Allowlist over open sending: Safety constraint; agent cannot email arbitrary addresses
- Mailgun via `mailgun.js`: SDK handles auth and API transport
- Factory function with injectable `MessagesAPI`: Enables testing without live Mailgun calls

## Invariants
- `send_email` tool always validates recipient against allowlist before calling sender
- Sender never throws; all failures returned as `SendResult { success: false }`

## Key Files
- `types.ts` -- `SendResult`, `SendEmailFn` (Functional Core)
- `sender.ts` -- `createMailgunSender` factory (Imperative Shell)
- `tools.ts` -- `createEmailTools` with allowlist enforcement (Imperative Shell)
- `index.ts` -- Barrel exports
