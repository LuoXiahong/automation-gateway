import { Context } from "telegraf";
import type { Response } from "node-fetch";
import { AppConfig } from "../src/config";
import { handleUserTextMessage } from "../src/telegramBot";
import {
  AllowedChatRepository,
  UserStateRepository,
} from "../src/db";
import { HttpClient } from "../src/httpClient";

interface TestContext {
  chat: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<void>;
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
    async listAllowedChats(): Promise<number[]> {
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
      masterChatId: 1,
    };

    let storedState = "awaiting_plan";
    const userStateRepository: UserStateRepository = {
      async getUserState(userId: number): Promise<string> {
        expect(userId).toBe(12345);
        return storedState;
      },
      async setUserState(userId: number, newState: string): Promise<void> {
        expect(userId).toBe(12345);
        storedState = newState;
      },
    };

    const postedPayloads: Array<{
      url: string;
      body: unknown;
      headers?: Record<string, string>;
    }> = [];

    const httpClient: HttpClient = {
      async post(
        url: string,
        body: unknown,
        headers?: Record<string, string>,
      ) {
        postedPayloads.push({ url, body, headers });
        return { ok: true } as Response;
      },
    };

    await handleUserTextMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      httpClient,
    });

    expect(postedPayloads).toHaveLength(1);
    expect(postedPayloads[0].url).toBe(config.n8nWebhookUrl);
    expect(postedPayloads[0].body).toEqual({
      chatId: 12345,
      text: "Mój plan działania",
    });

    expect(storedState).toBe("default");
    expect(sentReplies.length).toBe(1);
    expect(sentReplies[0]).toContain("przekazuję Twój plan");
  });

  it("Given user is in awaiting_plan state and webhook fails, When user sends a message, Then do not reset state and inform user about failure", async () => {
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
      masterChatId: 1,
    };

    let storedState = "awaiting_plan";
    const userStateRepository: UserStateRepository = {
      async getUserState(userId: number): Promise<string> {
        expect(userId).toBe(111);
        return storedState;
      },
      async setUserState(userId: number, newState: string): Promise<void> {
        storedState = newState;
      },
    };

    const httpClient: HttpClient = {
      async post() {
        return { ok: false } as Response;
      },
    };

    await handleUserTextMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      httpClient,
    });

    expect(storedState).toBe("awaiting_plan");
    expect(sentReplies.length).toBe(1);
    expect(sentReplies[0]).toContain("chwilowo niedostępny");
  });

  it("Given user is in awaiting_plan state and webhook throws, When user sends a message, Then do not reset state and inform user about retry later", async () => {
    const sentReplies: string[] = [];
    const fakeCtx: TestContext = {
      chat: { id: 222 },
      message: { text: "Plan z wyjątkiem" },
      reply: async (text: string) => {
        sentReplies.push(text);
      },
    };

    const config: AppConfig = {
      telegramBotToken: "test-token",
      databaseUrl: "postgres://user:pass@localhost:5432/db",
      internalApiKey: "internal-key",
      n8nWebhookUrl: "http://n8n:5678/webhook/ai-gateway",
      masterChatId: 1,
    };

    let storedState = "awaiting_plan";
    const userStateRepository: UserStateRepository = {
      async getUserState(userId: number): Promise<string> {
        expect(userId).toBe(222);
        return storedState;
      },
      async setUserState(userId: number, newState: string): Promise<void> {
        storedState = newState;
      },
    };

    const httpClient: HttpClient = {
      async post() {
        throw new Error("network error");
      },
    };

    await handleUserTextMessage(fakeCtx as unknown as Context, {
      config,
      userStateRepository,
      allowedChatRepository,
      httpClient,
    });

    expect(storedState).toBe("awaiting_plan");
    expect(sentReplies.length).toBe(1);
    expect(sentReplies[0]).toContain("Spróbuj ponownie później");
  });
});

