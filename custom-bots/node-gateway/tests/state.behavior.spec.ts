import { Context } from "telegraf";
import { AppConfig } from "../src/config";
import { asChatId, chatIdToNumber } from "../src/domain";
import { handleUserTextMessage, handleUserVoiceMessage } from "../src/telegramBot";
import {
  AllowedChatRepository,
  EnqueuePlanInput,
  OutboxRepository,
  UserStateRepository,
} from "../src/db";

interface TestContext {
  chat: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<void>;
}

interface TestVoiceContext {
  chat: { id: number };
  message: { voice: { file_id: string; duration: number; file_size?: number } };
  reply: (text: string) => Promise<void>;
  telegram: {
    getFileLink: (fileId: string) => Promise<string>;
    getFile: (fileId: string) => Promise<{ file_size?: number }>;
  };
}

describe("User state behavior", () => {
  const allowedChatRepository: AllowedChatRepository = {
    async isAllowed(): Promise<boolean> {
      return true;
    },
    async allowChat(): Promise<void> {
      // no-op
    },
    async revokeChat(): Promise<void> {
      // no-op
    },
    async listAllowedChats() {
      return [];
    },
  };

  it("Given user is in awaiting_plan state, When user sends a message, Then forward to n8n and set state to default", async () => {
    const sentReplies: string[] = [];
    const fakeCtx: TestContext = {
      chat: { id: 12345 },
      message: { text: "Mój plan działania" },
      reply: async (text: string) => {
        sentReplies.push(text);
      },
    };

    const config: AppConfig = {
      telegramBotToken: "test-token",
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      internalApiKey: "internal-key",
      n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
      n8nWebhookSecret: "webhook-secret",
      masterChatId: asChatId(1),
      voiceBase64MaxBytes: 1024,
      outboxProcessedTtlHours: 72,
      outboxPollIntervalMs: 5000,
      outboxBatchSize: 10,
      outboxMaxRetries: 5,
    };

    const userStateRepository: UserStateRepository = {
      async getUserState(userId: number): Promise<string> {
        expect(userId).toBe(12345);
        return "awaiting_plan";
      },
      async setUserState(): Promise<void> {
        // no-op
      },
    };

    const enqueued: EnqueuePlanInput[] = [];
    const outboxRepository: OutboxRepository = {
      async enqueuePlanAndSetDefaultState(input: EnqueuePlanInput): Promise<{ eventId: string }> {
        enqueued.push(input);
        return { eventId: input.eventId };
      },
      async getPendingBatch(): Promise<never[]> {
        return [];
      },
      async markProcessed(): Promise<void> {},
      async markFailed(): Promise<void> {},
      async markDeadLetter(): Promise<void> {},
      async scheduleRetry(): Promise<void> {},
      async pruneProcessedEvents(): Promise<number> {
        return 0;
      },
    };

    await handleUserTextMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      outboxRepository,
      downloadAudioBuffer: async () => Buffer.from("unused"),
    });

    expect(enqueued).toHaveLength(1);
    expect(chatIdToNumber(enqueued[0].chatId)).toBe(12345);
    expect(enqueued[0].correlationId).toEqual(expect.any(String));
    expect(enqueued[0].eventId).toEqual(expect.any(String));
    expect(chatIdToNumber(enqueued[0].payload.chatId)).toBe(12345);
    expect(enqueued[0].payload.text).toBe("Mój plan działania");
    expect(sentReplies.length).toBe(1);
    expect(sentReplies[0]).toContain("przekazuję Twój plan");
  });

  it("Given user is in awaiting_plan state and outbox save fails, When user sends a message, Then inform user about retry later", async () => {
    const sentReplies: string[] = [];
    const fakeCtx: TestContext = {
      chat: { id: 111 },
      message: { text: "Plan który nie przejdzie" },
      reply: async (text: string) => {
        sentReplies.push(text);
      },
    };

    const config: AppConfig = {
      telegramBotToken: "test-token",
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      internalApiKey: "internal-key",
      n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
      n8nWebhookSecret: "webhook-secret",
      masterChatId: asChatId(1),
      voiceBase64MaxBytes: 1024,
      outboxProcessedTtlHours: 72,
      outboxPollIntervalMs: 5000,
      outboxBatchSize: 10,
      outboxMaxRetries: 5,
    };

    const userStateRepository: UserStateRepository = {
      async getUserState(chatId): Promise<string> {
        expect(chatIdToNumber(chatId)).toBe(111);
        return "awaiting_plan";
      },
      async setUserState(): Promise<void> {
        // no-op
      },
    };

    const outboxRepository: OutboxRepository = {
      async enqueuePlanAndSetDefaultState() {
        throw new Error("db unavailable");
      },
      async getPendingBatch(): Promise<never[]> {
        return [];
      },
      async markProcessed(): Promise<void> {},
      async markFailed(): Promise<void> {},
      async markDeadLetter(): Promise<void> {},
      async scheduleRetry(): Promise<void> {},
      async pruneProcessedEvents(): Promise<number> {
        return 0;
      },
    };

    await handleUserTextMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      outboxRepository,
      downloadAudioBuffer: async () => Buffer.from("unused"),
    });

    expect(sentReplies.length).toBe(1);
    expect(sentReplies[0]).toContain("Spróbuj ponownie później");
  });

  it("Given user is in awaiting_plan state, When user sends a voice message, Then encode audio to base64 and enqueue event", async () => {
    const sentReplies: string[] = [];
    const downloadedBuffer = Buffer.from("voice-data");
    const fakeCtx: TestVoiceContext = {
      chat: { id: 777 },
      message: { voice: { file_id: "voice-file-123", duration: 6, file_size: 20 } },
      reply: async (text: string) => {
        sentReplies.push(text);
      },
      telegram: {
        getFileLink: async () => "https://api.telegram.org/file/bot-token/voice/abc.ogg",
        getFile: async () => ({ file_size: 20 }),
      },
    };

    const config: AppConfig = {
      telegramBotToken: "test-token",
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      internalApiKey: "internal-key",
      n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
      n8nWebhookSecret: "webhook-secret",
      masterChatId: asChatId(1),
      voiceBase64MaxBytes: 1024,
      outboxProcessedTtlHours: 72,
      outboxPollIntervalMs: 5000,
      outboxBatchSize: 10,
      outboxMaxRetries: 5,
    };

    const userStateRepository: UserStateRepository = {
      async getUserState(chatId): Promise<string> {
        expect(chatIdToNumber(chatId)).toBe(777);
        return "awaiting_plan";
      },
      async setUserState(): Promise<void> {
        // no-op
      },
    };

    const enqueued: EnqueuePlanInput[] = [];
    const outboxRepository: OutboxRepository = {
      async enqueuePlanAndSetDefaultState(input: EnqueuePlanInput): Promise<{ eventId: string }> {
        enqueued.push(input);
        return { eventId: input.eventId };
      },
      async getPendingBatch(): Promise<never[]> {
        return [];
      },
      async markProcessed(): Promise<void> {},
      async markFailed(): Promise<void> {},
      async markDeadLetter(): Promise<void> {},
      async scheduleRetry(): Promise<void> {},
      async pruneProcessedEvents(): Promise<number> {
        return 0;
      },
    };

    await handleUserVoiceMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      outboxRepository,
      downloadAudioBuffer: async () => downloadedBuffer,
    });

    expect(enqueued).toHaveLength(1);
    expect(chatIdToNumber(enqueued[0].payload.chatId)).toBe(777);
    expect(enqueued[0].payload.text).toBe("[VOICE]");
    expect(enqueued[0].payload.voiceBase64).toBe(downloadedBuffer.toString("base64"));
    expect(enqueued[0].payload.voiceMimeType).toBe("audio/ogg");
    expect(enqueued[0].payload.voiceDurationSeconds).toBe(6);
    expect(sentReplies[0]).toContain("przekazuję Twój plan");
  });

  it("Given user is in awaiting_plan state and voice is larger than limit, When user sends voice, Then reject before downloading file", async () => {
    const sentReplies: string[] = [];
    const downloadCalls: string[] = [];
    const outboxCalls: EnqueuePlanInput[] = [];
    const fakeCtx: TestVoiceContext = {
      chat: { id: 888 },
      message: { voice: { file_id: "voice-456", duration: 20, file_size: 10_000 } },
      reply: async (text: string) => {
        sentReplies.push(text);
      },
      telegram: {
        getFileLink: async () => "https://example.com/voice.ogg",
        getFile: async () => ({ file_size: 10_000 }),
      },
    };

    const config: AppConfig = {
      telegramBotToken: "test-token",
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      internalApiKey: "internal-key",
      n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
      n8nWebhookSecret: "webhook-secret",
      masterChatId: asChatId(1),
      voiceBase64MaxBytes: 2048,
      outboxProcessedTtlHours: 72,
      outboxPollIntervalMs: 5000,
      outboxBatchSize: 10,
      outboxMaxRetries: 5,
    };

    const userStateRepository: UserStateRepository = {
      async getUserState(): Promise<string> {
        return "awaiting_plan";
      },
      async setUserState(): Promise<void> {
        // no-op
      },
    };

    const outboxRepository: OutboxRepository = {
      async enqueuePlanAndSetDefaultState(input: EnqueuePlanInput): Promise<{ eventId: string }> {
        outboxCalls.push(input);
        return { eventId: input.eventId };
      },
      async getPendingBatch(): Promise<never[]> {
        return [];
      },
      async markProcessed(): Promise<void> {},
      async markFailed(): Promise<void> {},
      async markDeadLetter(): Promise<void> {},
      async scheduleRetry(): Promise<void> {},
      async pruneProcessedEvents(): Promise<number> {
        return 0;
      },
    };

    await handleUserVoiceMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      outboxRepository,
      downloadAudioBuffer: async (url: string) => {
        downloadCalls.push(url);
        return Buffer.from("should-not-download");
      },
    });

    expect(downloadCalls).toHaveLength(0);
    expect(outboxCalls).toHaveLength(0);
    expect(sentReplies[0]).toContain("zbyt duża");
  });
});
