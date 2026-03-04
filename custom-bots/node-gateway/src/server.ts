import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "./config.js";
import { AllowedChatRepository, UserStateRepository } from "./db.js";
import { Telegraf, Context } from "telegraf";

interface InternalMessageBody {
  chatId: number;
  text: string;
  newState?: string;
}

interface StressAlertBody {
  stressValue: number;
}

export interface ServerDependencies {
  config: AppConfig;
  userStateRepository: UserStateRepository;
  allowedChatRepository: AllowedChatRepository;
  bot: Telegraf<Context>;
}

export function createServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.post<{
    Body: InternalMessageBody;
  }>("/api/internal/message", async (request, reply) => {
    const apiKey = request.headers["x-internal-api-key"];
    if (apiKey !== deps.config.internalApiKey) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { chatId, text, newState } = request.body;

    if (typeof chatId !== "number" || typeof text !== "string") {
      return reply.status(400).send({ error: "Invalid payload" });
    }

    await deps.bot.telegram.sendMessage(chatId, text);

    if (newState) {
      await deps.userStateRepository.setUserState(chatId, newState);
    }

    return reply.status(200).send({ status: "ok" });
  });

  app.post<{
    Body: StressAlertBody;
  }>("/api/internal/stress-alert", async (request, reply) => {
    const apiKey = request.headers["x-internal-api-key"];
    if (apiKey !== deps.config.internalApiKey) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { stressValue } = request.body;

    if (typeof stressValue !== "number" || Number.isNaN(stressValue)) {
      return reply.status(400).send({ error: "Invalid payload" });
    }

    const recipients = new Set<number>();
    recipients.add(deps.config.masterChatId);

    const allowedChats =
      await deps.allowedChatRepository.listAllowedChats();
    for (const chatId of allowedChats) {
      recipients.add(chatId);
    }

    const message =
      "Uwaga: wykryto podwyższony poziom stresu " +
      `(${stressValue}). Zatrzymaj się na chwilę, ` +
      "weź kilka spokojnych oddechów i rozważ, czy potrzebujesz zmienić plan dnia.";

    await Promise.all(
      Array.from(recipients).map(async (chatId) => {
        await deps.bot.telegram.sendMessage(chatId, message);
        await deps.userStateRepository.setUserState(
          chatId,
          "awaiting_plan",
        );
      }),
    );

    return reply
      .status(200)
      .send({ status: "ok", recipients: Array.from(recipients) });
  });

  return app;
}

