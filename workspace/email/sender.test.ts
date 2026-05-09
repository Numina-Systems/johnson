import { describe, it, expect } from "bun:test";
import { createMailgunSender, type MessagesAPI } from "./sender.ts";

describe("agent-email.AC1.1: Sender sends text email", () => {
  it("should return success with messageId when Mailgun succeeds with text format", async () => {
    const mockMessages: MessagesAPI = {
      async create(domain, data) {
        expect(domain).toBe("example.com");
        expect(data["from"]).toBe("noreply@example.com");
        expect(data["to"]).toBe("user@example.com");
        expect(data["subject"]).toBe("Test Subject");
        expect(data["text"]).toBe("Test body");
        expect(data["html"]).toBeUndefined();

        return {
          id: "<20250302.123456@example.com>",
          message: "Queued",
          status: 200,
        };
      },
    };

    const sender = createMailgunSender({
      apiKey: "test-api-key",
      domain: "example.com",
      fromAddress: "noreply@example.com",
      messages: mockMessages,
    });

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result).toEqual({
      success: true,
      messageId: "<20250302.123456@example.com>",
    });
  });
});

describe("agent-email.AC1.2: Sender sends HTML email", () => {
  it("should return success with messageId when Mailgun succeeds with html format", async () => {
    const mockMessages: MessagesAPI = {
      async create(domain, data) {
        expect(domain).toBe("example.com");
        expect(data["from"]).toBe("noreply@example.com");
        expect(data["to"]).toBe("user@example.com");
        expect(data["subject"]).toBe("Test Subject");
        expect(data["html"]).toBe("<html><body>Test HTML</body></html>");
        expect(data["text"]).toBeUndefined();

        return {
          id: "<20250302.234567@example.com>",
          message: "Queued",
          status: 200,
        };
      },
    };

    const sender = createMailgunSender({
      apiKey: "test-api-key",
      domain: "example.com",
      fromAddress: "noreply@example.com",
      messages: mockMessages,
    });

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "<html><body>Test HTML</body></html>",
      "html",
    );

    expect(result).toEqual({
      success: true,
      messageId: "<20250302.234567@example.com>",
    });
  });
});

describe("agent-email.AC1.3: Sender handles Mailgun API errors", () => {
  it("should return failure when Mailgun API returns non-2xx status", async () => {
    const mockMessages: MessagesAPI = {
      async create() {
        const error = new Error("Forbidden") as Error & { statusCode: number };
        error.statusCode = 401;
        throw error;
      },
    };

    const sender = createMailgunSender({
      apiKey: "test-api-key",
      domain: "example.com",
      fromAddress: "noreply@example.com",
      messages: mockMessages,
    });

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Forbidden");
    }
  });
});

describe("agent-email.AC1.4: Sender handles network errors", () => {
  it("should return failure when Mailgun request throws network error", async () => {
    const mockMessages: MessagesAPI = {
      async create() {
        throw new Error("ECONNREFUSED");
      },
    };

    const sender = createMailgunSender({
      apiKey: "test-api-key",
      domain: "example.com",
      fromAddress: "noreply@example.com",
      messages: mockMessages,
    });

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("ECONNREFUSED");
    }
  });
});
