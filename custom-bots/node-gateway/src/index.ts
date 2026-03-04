import { loadConfig } from "./config.js";
import {
  createAllowedChatRepository,
  createPool,
  createUserStateRepository,
  runMigrations,
} from "./db.js";
import { createHttpClient } from "./httpClient.js";
import { createBot } from "./telegramBot.js";
import { createServer } from "./server.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const userStateRepository = createUserStateRepository(pool);
  const allowedChatRepository = createAllowedChatRepository(pool);

  const httpClient = createHttpClient();
  const bot = createBot({
    config,
    userStateRepository,
    allowedChatRepository,
    httpClient,
  });

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
    bot.stop("SIGINT");
    void server.close();
    void pool.end();
  });
  process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
    void server.close();
    void pool.end();
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap node-gateway", err);
  process.exit(1);
});

