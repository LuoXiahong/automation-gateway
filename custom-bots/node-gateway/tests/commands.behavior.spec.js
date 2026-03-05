import { asChatId, chatIdToNumber } from "../src/domain";
import { handleAllowedListCommand, handleAllowHereCommand, handleImpulsCommand, handleRevokeHereCommand, handleStartCommand, MENU_CB, } from "../src/telegramBot";
class FakeContext {
    constructor(chatId, fromId) {
        this.chatId = chatId;
        this.fromId = fromId;
        this.replies = [];
        this.replyExtra = null;
        this.telegram = null;
        this.chat = { id: chatId };
        this.from = { id: fromId };
    }
    async reply(text, extra) {
        this.replies.push(text);
        this.replyExtra = extra ?? null;
    }
}
function createFakeTelegram() {
    const sendMessageCalls = [];
    return {
        sendMessageCalls,
        async sendMessage(chatId, text) {
            sendMessageCalls.push({ chatId, text });
        },
    };
}
describe("Bot command handlers", () => {
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
    let storedState = null;
    let allowedChats = [];
    const userStateRepository = {
        async getUserState() {
            return storedState?.state ?? "default";
        },
        async setUserState(chatId, newState) {
            storedState = { userId: chatIdToNumber(chatId), state: newState };
        },
    };
    const allowedChatRepository = {
        async isAllowed(chatId) {
            return allowedChats.includes(chatIdToNumber(chatId));
        },
        async allowChat(chatId) {
            const n = chatIdToNumber(chatId);
            if (!allowedChats.includes(n)) {
                allowedChats.push(n);
            }
        },
        async revokeChat(chatId) {
            allowedChats = allowedChats.filter((id) => id !== chatIdToNumber(chatId));
        },
        async listAllowedChats() {
            return allowedChats.map((id) => asChatId(id));
        },
    };
    beforeEach(() => {
        storedState = null;
        allowedChats = [];
    });
    it("Given /impuls command, When invoked by any user, Then sets cooling_down_120s state and replies with guidance", async () => {
        const ctx = new FakeContext(123, 999);
        await handleImpulsCommand(ctx, {
            userStateRepository,
        });
        expect(storedState).toEqual({
            userId: 123,
            state: "cooling_down_120s",
        });
        expect(ctx.replies[0]).toContain("120 sekund");
    });
    describe("handleImpulsCommand 120s timer", () => {
        const COOLDOWN_FINISHED_MESSAGE = "Czas minął. Chłodny umysł przywrócony. Jaki masz teraz plan działania?";
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });
        it("Given /impuls invoked, When 120 seconds elapse, Then bot sends cooldown-finished message and state becomes awaiting_plan", async () => {
            const fakeTelegram = createFakeTelegram();
            const ctx = new FakeContext(456, 999);
            ctx.telegram = fakeTelegram;
            await handleImpulsCommand(ctx, { userStateRepository });
            expect(storedState?.state).toBe("cooling_down_120s");
            await jest.advanceTimersByTimeAsync(120000);
            expect(storedState?.userId).toBe(456);
            expect(storedState?.state).toBe("awaiting_plan");
            expect(fakeTelegram.sendMessageCalls).toHaveLength(1);
            expect(fakeTelegram.sendMessageCalls[0].chatId).toBe(456);
            expect(fakeTelegram.sendMessageCalls[0].text).toBe(COOLDOWN_FINISHED_MESSAGE);
        });
    });
    it("Given owner uses /allow_here, When invoked in chat, Then chat is added to whitelist", async () => {
        const ctx = new FakeContext(200, 1);
        await handleAllowHereCommand(ctx, {
            config,
            allowedChatRepository,
        });
        expect(allowedChats).toContain(200);
        expect(ctx.replies[0]).toContain("dodany do whitelisty");
    });
    it("Given owner uses /revoke_here, When invoked in chat, Then chat is removed from whitelist", async () => {
        allowedChats = [300];
        const ctx = new FakeContext(300, 1);
        await handleRevokeHereCommand(ctx, {
            config,
            allowedChatRepository,
        });
        expect(allowedChats).not.toContain(300);
        expect(ctx.replies[0]).toContain("usunięty z whitelisty");
    });
    it("Given owner uses /allowed_list, When whitelist has entries, Then replies with formatted list", async () => {
        allowedChats = [10, 20];
        const ctx = new FakeContext(1, 1);
        await handleAllowedListCommand(ctx, {
            config,
            allowedChatRepository,
        });
        expect(ctx.replies[0]).toContain("Aktualna whitelist'a czatów");
        expect(ctx.replies[0]).toContain("- 10");
        expect(ctx.replies[0]).toContain("- 20");
    });
    describe("handleStartCommand", () => {
        it("Given /start by regular user, When invoked, Then sends welcome and menu with only Impuls button", async () => {
            const ctx = new FakeContext(123, 999);
            await handleStartCommand(ctx, { config });
            expect(ctx.replies[0]).toContain("Witaj!");
            expect(ctx.replies[0]).toContain("Wybierz akcję");
            const markup = ctx.replyExtra;
            expect(markup?.reply_markup?.inline_keyboard).toBeDefined();
            const rows = markup.reply_markup.inline_keyboard;
            expect(rows).toHaveLength(1);
            expect(rows[0][0]).toMatchObject({
                text: expect.stringContaining("Impuls"),
                callback_data: MENU_CB.IMPULS,
            });
        });
        it("Given /start by master, When invoked, Then sends welcome and menu with Impuls + admin buttons", async () => {
            const ctx = new FakeContext(1, 1);
            await handleStartCommand(ctx, { config });
            expect(ctx.replies[0]).toContain("Witaj!");
            const markup = ctx.replyExtra;
            const rows = markup.reply_markup.inline_keyboard;
            expect(rows.length).toBeGreaterThanOrEqual(2);
            expect(rows[0][0]).toMatchObject({ callback_data: MENU_CB.IMPULS });
            expect(rows[1].some((btn) => btn.callback_data === MENU_CB.ALLOW_HERE)).toBe(true);
            expect(rows[1].some((btn) => btn.callback_data === MENU_CB.REVOKE_HERE)).toBe(true);
            const listRow = rows.find((row) => row.some((btn) => btn.callback_data === MENU_CB.ALLOWED_LIST));
            expect(listRow).toBeDefined();
        });
    });
});
