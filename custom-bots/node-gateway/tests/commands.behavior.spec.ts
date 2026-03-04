import type { Context } from "telegraf";
import { AppConfig } from "../src/config";
import {
  AllowedChatRepository,
  UserStateRepository,
} from "../src/db";
import {
  handleAllowedListCommand,
  handleAllowHereCommand,
  handleImpulsCommand,
  handleRevokeHereCommand,
} from "../src/telegramBot";

class FakeContext {
  public replies: string[] = [];

  constructor(public chatId: number, public fromId: number) {
    this.chat = { id: chatId };
    this.from = { id: fromId };
  }

  chat: { id: number };
  from: { id: number };

  async reply(text: string): Promise<void> {
    this.replies.push(text);
  }
}

describe("Bot command handlers", () => {
  const config: AppConfig = {
    telegramBotToken: "test-token",
    databaseUrl: "postgres://user:pass@localhost:5432/db",
    internalApiKey: "internal-key",
    n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
    masterChatId: 1,
  };

  let storedState: { userId: number; state: string } | null = null;
  let allowedChats: number[] = [];

  const userStateRepository: UserStateRepository = {
    async getUserState(): Promise<string> {
      return storedState?.state ?? "default";
    },
    async setUserState(userId: number, newState: string): Promise<void> {
      storedState = { userId, state: newState };
    },
  };

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
    storedState = null;
    allowedChats = [];
  });

  it("Given /impuls command, When invoked by any user, Then sets cooling_down_120s state and replies with guidance", async () => {
    const ctx = new FakeContext(123, 999);

    await handleImpulsCommand(ctx as unknown as Context, {
      userStateRepository,
    });

    expect(storedState).toEqual({
      userId: 123,
      state: "cooling_down_120s",
    });
    expect(ctx.replies[0]).toContain("120 sekund");
  });

  it("Given owner uses /allow_here, When invoked in chat, Then chat is added to whitelist", async () => {
    const ctx = new FakeContext(200, 1);

    await handleAllowHereCommand(ctx as unknown as Context, {
      config,
      allowedChatRepository,
    });

    expect(allowedChats).toContain(200);
    expect(ctx.replies[0]).toContain("dodany do whitelisty");
  });

  it("Given owner uses /revoke_here, When invoked in chat, Then chat is removed from whitelist", async () => {
    allowedChats = [300];
    const ctx = new FakeContext(300, 1);

    await handleRevokeHereCommand(ctx as unknown as Context, {
      config,
      allowedChatRepository,
    });

    expect(allowedChats).not.toContain(300);
    expect(ctx.replies[0]).toContain("usunięty z whitelisty");
  });

  it("Given owner uses /allowed_list, When whitelist has entries, Then replies with formatted list", async () => {
    allowedChats = [10, 20];
    const ctx = new FakeContext(1, 1);

    await handleAllowedListCommand(ctx as unknown as Context, {
      config,
      allowedChatRepository,
    });

    expect(ctx.replies[0]).toContain("Aktualna whitelist'a czatów");
    expect(ctx.replies[0]).toContain("- 10");
    expect(ctx.replies[0]).toContain("- 20");
  });
});

