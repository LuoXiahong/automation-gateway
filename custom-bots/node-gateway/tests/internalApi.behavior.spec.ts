import { FastifyInstance } from "fastify";
import { createServer } from "../src/server";
import { AppConfig } from "../src/config";
import { asChatId, chatIdToNumber } from "../src/domain";
import { AllowedChatRepository, UserStateRepository } from "../src/db";
import { Telegraf, Context } from "telegraf";

class FakeTelegram {
  public readonly sent: Array<{ chatId: number; text: string }> = [];

  async sendMessage(chatId: number, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

describe("Internal APIs", () => {
  let app: FastifyInstance;
  let telegram: FakeTelegram;
  let updatedState: { userId: number; state: string } | null = null;
  let allowedChats: number[] = [];

  beforeEach(() => {
    const config: AppConfig = {
      telegramBotToken: "test",
      databaseUrl: "postgres://user:pass@localhost/db",
      internalApiKey: "secret-key",
      n8nWebhookUrl: "http://n8n/webhook",
      n8nWebhookSecret: "webhook-secret",
      masterChatId: asChatId(1),
      voiceBase64MaxBytes: 1024,
      outboxProcessedTtlHours: 72,
      outboxPollIntervalMs: 5000,
      outboxBatchSize: 10,
      outboxMaxRetries: 5,
    };

    telegram = new FakeTelegram();

    const bot = {
      telegram,
    } as unknown as Telegraf<Context>;

    const userStateRepository: UserStateRepository = {
      async getUserState(): Promise<string> {
        return "default";
      },
      async setUserState(chatId, state: string): Promise<void> {
        updatedState = { userId: chatIdToNumber(chatId), state };
      },
    };

    const allowedChatRepository: AllowedChatRepository = {
      async isAllowed(chatId): Promise<boolean> {
        return allowedChats.includes(chatIdToNumber(chatId));
      },
      async allowChat(chatId): Promise<void> {
        const n = chatIdToNumber(chatId);
        if (!allowedChats.includes(n)) {
          allowedChats.push(n);
        }
      },
      async revokeChat(chatId): Promise<void> {
        allowedChats = allowedChats.filter((id) => id !== chatIdToNumber(chatId));
      },
      async listAllowedChats() {
        return allowedChats.map((id) => asChatId(id));
      },
    };

    app = createServer({
      config,
      userStateRepository,
      allowedChatRepository,
      bot,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("Given valid api key and payload, When calling internal message API, Then sends telegram message and updates state", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "secret-key",
        "content-type": "application/json",
      },
      payload: {
        chatId: 999,
        text: "Alert: high stress",
        newState: "awaiting_plan",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toEqual({
      chatId: 999,
      text: "Alert: high stress",
    });
    expect(updatedState).toEqual({
      userId: 999,
      state: "awaiting_plan",
    });
  });

  it("Given invalid api key, When calling internal message API, Then responds with unauthorized", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "wrong",
        "content-type": "application/json",
      },
      payload: {
        chatId: 999,
        text: "Should not be sent",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("Given missing fields in payload, When calling internal message API, Then responds with bad request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/message",
      headers: {
        "x-internal-api-key": "secret-key",
        "content-type": "application/json",
      },
      payload: {
        chatId: "not-a-number",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("Given stress alert event, When calling stress-alert API, Then broadcasts to owner and allowed chats and sets awaiting_plan", async () => {
    allowedChats = [10, 20];

    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "secret-key",
        "content-type": "application/json",
      },
      payload: {
        stressValue: 85,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as { recipients: number[] };
    expect(new Set(body.recipients)).toEqual(new Set([1, 10, 20]));

    const sentTo = telegram.sent.map((m) => m.chatId);
    expect(new Set(sentTo)).toEqual(new Set([1, 10, 20]));

    expect(updatedState).not.toBeNull();
    if (updatedState) {
      expect(updatedState.state).toBe("awaiting_plan");
    }
  });

  it("Given stress alert with optional restingHeartRate, When calling stress-alert API, Then message includes resting heart rate", async () => {
    allowedChats = [];
    const response = await app.inject({
      method: "POST",
      url: "/api/internal/stress-alert",
      headers: {
        "x-internal-api-key": "secret-key",
        "content-type": "application/json",
      },
      payload: {
        stressValue: 75,
        restingHeartRate: 55,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].text).toContain("75");
    expect(telegram.sent[0].text).toContain("Tętno spoczynkowe: 55");
  });
});
