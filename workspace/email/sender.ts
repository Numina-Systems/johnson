// pattern: Imperative Shell

import Mailgun from "mailgun.js";
import type { SendEmailFn, SendResult } from "./types.ts";

export type MessagesAPI = {
  create(
    domain: string,
    data: Record<string, unknown>,
  ): Promise<{ id?: string; message?: string; status?: number }>;
};

export type CreateMailgunSenderOptions = {
  apiKey: string;
  domain: string;
  fromAddress: string;
  messages?: MessagesAPI;
};

export function createMailgunSender(
  options: CreateMailgunSenderOptions,
): SendEmailFn {
  const { apiKey, domain, fromAddress, messages } = options;
  let messagesAPI: MessagesAPI;

  if (messages) {
    messagesAPI = messages;
  } else {
    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({ username: "api", key: apiKey });
    messagesAPI = mg.messages;
  }

  return async (
    to: string,
    subject: string,
    body: string,
    format: "text" | "html",
  ): Promise<SendResult> => {
    try {
      const messageData: Record<string, unknown> = {
        from: fromAddress,
        to,
        subject,
      };

      if (format === "html") {
        messageData["html"] = body;
      } else {
        messageData["text"] = body;
      }

      const response = await messagesAPI.create(domain, messageData);
      if (!response.id) {
        return {
          success: false,
          error: "Mailgun API returned no message ID",
        };
      }
      return {
        success: true,
        messageId: response.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: errorMessage,
      };
    }
  };
}
