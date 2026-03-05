import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppConfig } from "./config.js";
import { AllowedChatRepository, UserStateRepository } from "./db.js";
import { asChatId, chatIdToNumber } from "./domain.js";
import { Telegraf, Context } from "telegraf";

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
    await deps.bot.telegram.sendMessage(chatIdToNumber(chatIdDomain), text);

    if (newState) {
      await deps.userStateRepository.setUserState(chatIdDomain, newState);
    }

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

    const recipients = new Set<number>();
    recipients.add(chatIdToNumber(deps.config.masterChatId));

    const allowedChats = await deps.allowedChatRepository.listAllowedChats();
    for (const cid of allowedChats) {
      recipients.add(chatIdToNumber(cid));
    }

    let message =
      "Uwaga: wykryto podwyższony poziom stresu " +
      `(${stressValue}). Zatrzymaj się na chwilę, ` +
      "weź kilka spokojnych oddechów i rozważ, czy potrzebujesz zmienić plan dnia.";
    if (restingHeartRate !== undefined) {
      message += ` Tętno spoczynkowe: ${restingHeartRate}.`;
    }

    await Promise.all(
      Array.from(recipients).map(async (chatIdNum) => {
        const chatIdDomain = asChatId(chatIdNum);
        await deps.bot.telegram.sendMessage(chatIdNum, message);
        await deps.userStateRepository.setUserState(chatIdDomain, "awaiting_plan");
      })
    );

    return reply.status(200).send({ status: "ok", recipients: Array.from(recipients) });
  });

  return app;
}
