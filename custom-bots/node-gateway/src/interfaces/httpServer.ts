import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppConfig } from "../infrastructure/config.js";
import { asChatId, chatIdToNumber } from "../domain.js";
import type { Telegraf, Context } from "telegraf";
import type {
  AllowedChatRepository,
  TelegramGatewayPort,
  UserStateRepository,
} from "../application/ports.js";
import {
  handleInternalMessage,
  handleStressAlertBroadcast,
} from "../application/usecases/internalApi.js";

const internalMessageSchema = z.object({
  chatId: z.number().int(),
  text: z.string(),
  newState: z.string().optional(),
});

const stressAlertSchema = z.object({
  stressValue: z.number(),
  restingHeartRate: z.number().optional(),
});

export interface ServerDependencies {
  readonly config: AppConfig;
  readonly userStateRepository: UserStateRepository;
  readonly allowedChatRepository: AllowedChatRepository;
  readonly bot: Telegraf<Context>;
}

export function createServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.post("/api/internal/message", async (request, reply) => {
    const apiKey = request.headers["x-internal-api-key"];
    if (apiKey !== deps.config.internalApiKey) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const parsed = internalMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload" });
    }

    const { chatId, text, newState } = parsed.data;
    const chatIdDomain = asChatId(chatId);

    const telegramGateway: TelegramGatewayPort = {
      async sendMessage(targetChatId, message): Promise<void> {
        await deps.bot.telegram.sendMessage(chatIdToNumber(targetChatId), message);
      },
    };

    await handleInternalMessage(
      {
        userStateRepository: deps.userStateRepository,
        telegramGateway,
      },
      {
        chatId: chatIdDomain,
        text,
        newState,
      }
    );

    return reply.status(200).send({ status: "ok" });
  });

  app.post("/api/internal/stress-alert", async (request, reply) => {
    const apiKey = request.headers["x-internal-api-key"];
    if (apiKey !== deps.config.internalApiKey) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const parsed = stressAlertSchema.safeParse(request.body);
    if (!parsed.success || Number.isNaN(parsed.data.stressValue)) {
      return reply.status(400).send({ error: "Invalid payload" });
    }
    const { stressValue, restingHeartRate } = parsed.data;
    if (restingHeartRate !== undefined && Number.isNaN(restingHeartRate)) {
      return reply.status(400).send({ error: "Invalid payload" });
    }

    const telegramGateway: TelegramGatewayPort = {
      async sendMessage(targetChatId, message): Promise<void> {
        await deps.bot.telegram.sendMessage(chatIdToNumber(targetChatId), message);
      },
    };

    const recipientChatIds = await handleStressAlertBroadcast(
      {
        masterChatId: deps.config.masterChatId,
        allowedChatRepository: deps.allowedChatRepository,
        userStateRepository: deps.userStateRepository,
        telegramGateway,
      },
      {
        stressValue,
        restingHeartRate,
      }
    );

    const recipients = recipientChatIds.map((cid) => chatIdToNumber(cid));

    return reply.status(200).send({ status: "ok", recipients });
  });

  return app;
}
