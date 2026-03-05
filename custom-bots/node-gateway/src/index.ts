import { setupTracing } from "./infrastructure/tracing.js";
import { loadConfig } from "./infrastructure/config.js";
import {
  createAllowedChatRepository,
  createOutboxRepository,
  createPool,
  createUserStateRepository,
  runMigrations,
} from "./infrastructure/persistence.js";
import { createHttpClient } from "./infrastructure/httpClient.js";
import { runOutboxTick } from "./application/usecases/outboxProcessor.js";
import { createBot } from "./interfaces/telegramBot.js";
import { createServer } from "./interfaces/httpServer.js";
import fetch from "node-fetch";

async function bootstrap(): Promise<void> {
  setupTracing();

  const config = loadConfig();

  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const userStateRepository = createUserStateRepository(pool);
  const allowedChatRepository = createAllowedChatRepository(pool);
  const outboxRepository = createOutboxRepository(pool);
  const httpClient = createHttpClient();

  const bot = createBot({
    config,
    userStateRepository,
    allowedChatRepository,
    outboxRepository,
    downloadAudioBuffer: async (url: string): Promise<Buffer> => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Telegram audio download failed with status ${response.status}`);
      }
      const audioArrayBuffer = await response.arrayBuffer();
      return Buffer.from(audioArrayBuffer);
    },
  });

  const pruneIntervalMs = 60 * 60 * 1000;
  const pruneTimer = setInterval(() => {
    void (async () => {
      try {
        const deletedRows = await outboxRepository.pruneProcessedEvents(
          config.outboxProcessedTtlHours
        );
        if (deletedRows > 0) {
          console.warn(`Pruned ${deletedRows} processed outbox events`);
        }
      } catch (error) {
        console.error("Outbox pruning failed", error);
      }
    })();
  }, pruneIntervalMs);

  const outboxWorkerTimer = setInterval(() => {
    void runOutboxTick({
      config,
      outboxRepository,
      httpClient,
    }).catch((err) => {
      console.error("Outbox worker tick failed", err);
    });
  }, config.outboxPollIntervalMs);

  const server = createServer({
    config,
    userStateRepository,
    allowedChatRepository,
    bot,
  });

  const port = 8000;

  await server.listen({ host: "0.0.0.0", port });
  await bot.launch();

  process.once("SIGINT", () => {
    clearInterval(pruneTimer);
    clearInterval(outboxWorkerTimer);
    bot.stop("SIGINT");
    void server.close();
    void pool.end();
  });
  process.once("SIGTERM", () => {
    clearInterval(pruneTimer);
    clearInterval(outboxWorkerTimer);
    bot.stop("SIGTERM");
    void server.close();
    void pool.end();
  });
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap node-gateway", err);
  process.exit(1);
});
