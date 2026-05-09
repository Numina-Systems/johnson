// pattern: Functional Core

export type SendResult =
  | { readonly success: true; readonly messageId: string }
  | { readonly success: false; readonly error: string };

export type SendEmailFn = (
  to: string,
  subject: string,
  body: string,
  format: "text" | "html",
) => Promise<SendResult>;
