import { asChatId, chatIdToNumber } from "../src/domain";
import { handleUserTextMessage, handleUserVoiceMessage } from "../src/telegramBot";
describe("User state behavior", () => {
    const allowedChatRepository = {
        async isAllowed() {
            return true;
        },
        async allowChat() {
            // no-op
        },
        async revokeChat() {
            // no-op
        },
        async listAllowedChats() {
            return [];
        },
    };
    it("Given user is in awaiting_plan state, When user sends a message, Then forward to n8n and set state to default", async () => {
        const sentReplies = [];
        const fakeCtx = {
            chat: { id: 12345 },
            message: { text: "Mój plan działania" },
            reply: async (text) => {
                sentReplies.push(text);
            },
        };
        const config = {
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
        const userStateRepository = {
            async getUserState(userId) {
                expect(userId).toBe(12345);
                return "awaiting_plan";
            },
            async setUserState() {
                // no-op
            },
        };
        const enqueued = [];
        const outboxRepository = {
            async enqueuePlanAndSetDefaultState(input) {
                enqueued.push(input);
                return { eventId: input.eventId };
            },
            async getPendingBatch() {
                return [];
            },
            async markProcessed() { },
            async markFailed() { },
            async markDeadLetter() { },
            async scheduleRetry() { },
            async pruneProcessedEvents() {
                return 0;
            },
        };
        await handleUserTextMessage(fakeCtx, {
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
        const sentReplies = [];
        const fakeCtx = {
            chat: { id: 111 },
            message: { text: "Plan który nie przejdzie" },
            reply: async (text) => {
                sentReplies.push(text);
            },
        };
        const config = {
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
        const userStateRepository = {
            async getUserState(chatId) {
                expect(chatIdToNumber(chatId)).toBe(111);
                return "awaiting_plan";
            },
            async setUserState() {
                // no-op
            },
        };
        const outboxRepository = {
            async enqueuePlanAndSetDefaultState() {
                throw new Error("db unavailable");
            },
            async getPendingBatch() {
                return [];
            },
            async markProcessed() { },
            async markFailed() { },
            async markDeadLetter() { },
            async scheduleRetry() { },
            async pruneProcessedEvents() {
                return 0;
            },
        };
        await handleUserTextMessage(fakeCtx, {
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
        const sentReplies = [];
        const downloadedBuffer = Buffer.from("voice-data");
        const fakeCtx = {
            chat: { id: 777 },
            message: { voice: { file_id: "voice-file-123", duration: 6, file_size: 20 } },
            reply: async (text) => {
                sentReplies.push(text);
            },
            telegram: {
                getFileLink: async () => "https://api.telegram.org/file/bot-token/voice/abc.ogg",
                getFile: async () => ({ file_size: 20 }),
            },
        };
        const config = {
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
        const userStateRepository = {
            async getUserState(chatId) {
                expect(chatIdToNumber(chatId)).toBe(777);
                return "awaiting_plan";
            },
            async setUserState() {
                // no-op
            },
        };
        const enqueued = [];
        const outboxRepository = {
            async enqueuePlanAndSetDefaultState(input) {
                enqueued.push(input);
                return { eventId: input.eventId };
            },
            async getPendingBatch() {
                return [];
            },
            async markProcessed() { },
            async markFailed() { },
            async markDeadLetter() { },
            async scheduleRetry() { },
            async pruneProcessedEvents() {
                return 0;
            },
        };
        await handleUserVoiceMessage(fakeCtx, {
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
        const sentReplies = [];
        const downloadCalls = [];
        const outboxCalls = [];
        const fakeCtx = {
            chat: { id: 888 },
            message: { voice: { file_id: "voice-456", duration: 20, file_size: 10000 } },
            reply: async (text) => {
                sentReplies.push(text);
            },
            telegram: {
                getFileLink: async () => "https://example.com/voice.ogg",
                getFile: async () => ({ file_size: 10000 }),
            },
        };
        const config = {
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
        const userStateRepository = {
            async getUserState() {
                return "awaiting_plan";
            },
            async setUserState() {
                // no-op
            },
        };
        const outboxRepository = {
            async enqueuePlanAndSetDefaultState(input) {
                outboxCalls.push(input);
                return { eventId: input.eventId };
            },
            async getPendingBatch() {
                return [];
            },
            async markProcessed() { },
            async markFailed() { },
            async markDeadLetter() { },
            async scheduleRetry() { },
            async pruneProcessedEvents() {
                return 0;
            },
        };
        await handleUserVoiceMessage(fakeCtx, {
            config,
            userStateRepository,
            allowedChatRepository,
            outboxRepository,
            downloadAudioBuffer: async (url) => {
                downloadCalls.push(url);
                return Buffer.from("should-not-download");
            },
        });
        expect(downloadCalls).toHaveLength(0);
        expect(outboxCalls).toHaveLength(0);
        expect(sentReplies[0]).toContain("zbyt duża");
    });
});
