import { AppConfig } from "../src/config";
import { AllowedChatRepository } from "../src/db";
import { authorizeContext } from "../src/telegramBot";
import type { Context } from "telegraf";

describe("Auth middleware", () => {
  const config: AppConfig = {
    telegramBotToken: "test-token",
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    internalApiKey: "internal-key",
    n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
    n8nWebhookSecret: "webhook-secret",
    masterChatId: 1,
    voiceBase64MaxBytes: 1024,
    outboxProcessedTtlHours: 72,
    outboxPollIntervalMs: 5000,
    outboxBatchSize: 10,
    outboxMaxRetries: 5,
  };

  let allowedChats: number[] = [];

  const allowedChatRepository: AllowedChatRepository = {
    async isAllowed(chatId: number): Promise<boolean> {
      return allowedChats.includes(chatId);
    },
    async allowChat(chatId: number): Promise<void> {
      if (!allowedChats.includes(chatId)) {
        allowedChats.push(chatId);
      }
    },
    async revokeChat(chatId: number): Promise<void> {
      allowedChats = allowedChats.filter((id) => id !== chatId);
    },
    async listAllowedChats(): Promise<number[]> {
      return [...allowedChats];
    },
  };

  beforeEach(() => {
    allowedChats = [];
  });

  it("Given unauthorized user, When sending text, Then middleware blocks and no handler runs", async () => {
    const ctx = {
      from: { id: 999 },
      chat: { id: 42 },
    } as unknown as Context;

    let called = false;

    await authorizeContext(ctx, { config, allowedChatRepository }, async () => {
      called = true;
    });

    expect(called).toBe(false);
  });

  it("Given owner user, When sending text, Then middleware lets request through", async () => {
    const ctx = {
      from: { id: 1 },
      chat: { id: 100 },
    } as unknown as Context;

    let called = false;

    await authorizeContext(ctx, { config, allowedChatRepository }, async () => {
      called = true;
    });

    expect(called).toBe(true);
  });

  it("Given allowed non-owner user, When sending text, Then middleware lets request through", async () => {
    allowedChats = [200];

    const ctx = {
      from: { id: 999 },
      chat: { id: 200 },
    } as unknown as Context;

    let called = false;

    await authorizeContext(ctx, { config, allowedChatRepository }, async () => {
      called = true;
    });

    expect(called).toBe(true);
  });
});
