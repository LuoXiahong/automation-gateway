/**
 * Contract tests: verify node-gateway (consumer) HTTP interface
 * conforms to contracts/internal-api.openapi.yaml.
 *
 * These tests validate request/response shapes per OpenAPI spec.
 */
import { FastifyInstance } from "fastify";
import { createServer } from "../src/interfaces/httpServer";
import { AppConfig } from "../src/infrastructure/config";
import { asChatId, chatIdToNumber } from "../src/domain";
import type { AllowedChatRepository, UserStateRepository } from "../src/application/ports";
import { Telegraf, Context } from "telegraf";

class FakeTelegram {
  public readonly sent: Array<{ chatId: number; text: string }> = [];

  async sendMessage(chatId: number, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

function makeConfig(): AppConfig {
  return {
    telegramBotToken: "test",
    databaseUrl: "postgres://user:pass@localhost/db",
    internalApiKey: "contract-key",
    n8nWebhookUrl: "http://n8n/webhook",
    n8nWebhookSecret: "webhook-secret",
    masterChatId: asChatId(1),
    voiceBase64MaxBytes: 1024,
    outboxProcessedTtlHours: 72,
    outboxPollIntervalMs: 5000,
    outboxBatchSize: 10,
    outboxMaxRetries: 5,
  };
}

describe("Contract: /api/internal/stress-alert", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const telegram = new FakeTelegram();
    const bot = { telegram } as unknown as Telegraf<Context>;

    const userStateRepository: UserStateRepository = {
      async getUserState(): Promise<string> {
        return "default";
      },
      async setUserState(): Promise<void> {},
    };

    const allowedChatRepository: AllowedChatRepository = {
      async isAllowed(): Promise<boolean> {
        return false;
      },
      async allowChat(): Promise<void> {},
      async revokeChat(): Promise<void> {},
      async listAllowedChats() {
        return [];
      },
    };

    app = createServer({
      config: makeConfig(),
      userStateRepository,
      allowedChatRepository,
      bot,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("200 response matches StressAlertResponse schema: {status: 'ok', recipients: number[]}", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "contract-key",
        "x-correlation-id": "550e8400-e29b-41d4-a716-446655440000",
        "content-type": "application/json",
      },
      payload: { stressValue: 85 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("recipients");
    expect(Array.isArray(body.recipients)).toBe(true);
    for (const r of body.recipients) {
      expect(typeof r).toBe("number");
    }
  });

  it("400 response matches ErrorResponse schema: {error: string}", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("401 response matches ErrorResponse schema: {error: string}", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "wrong-key",
        "content-type": "application/json",
      },
      payload: { stressValue: 85 },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("accepts optional restingHeartRate per StressAlertRequest schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: { stressValue: 90, restingHeartRate: 55 },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Contract: /api/internal/message", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const telegram = new FakeTelegram();
    const bot = { telegram } as unknown as Telegraf<Context>;

    const userStateRepository: UserStateRepository = {
      async getUserState(): Promise<string> {
        return "default";
      },
      async setUserState(): Promise<void> {},
    };

    const allowedChatRepository: AllowedChatRepository = {
      async isAllowed(): Promise<boolean> {
        return false;
      },
      async allowChat(): Promise<void> {},
      async revokeChat(): Promise<void> {},
      async listAllowedChats() {
        return [];
      },
    };

    app = createServer({
      config: makeConfig(),
      userStateRepository,
      allowedChatRepository,
      bot,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("200 response matches OkResponse schema: {status: 'ok'}", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: { chatId: 42, text: "Hello" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("status", "ok");
  });

  it("accepts optional newState per InternalMessageRequest schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: { chatId: 42, text: "Hello", newState: "awaiting_plan" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("400 response for missing required chatId field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: { text: "Missing chatId" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty("error");
  });

  it("400 response for missing required text field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "contract-key",
        "content-type": "application/json",
      },
      payload: { chatId: 42 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toHaveProperty("error");
  });

  it("401 response for wrong API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "wrong",
        "content-type": "application/json",
      },
      payload: { chatId: 42, text: "Hello" },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body).toHaveProperty("error");
  });
});
