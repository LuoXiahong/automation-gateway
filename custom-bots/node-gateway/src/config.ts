export interface AppConfig {
  telegramBotToken: string;
  databaseUrl: string;
  internalApiKey: string;
  n8nWebhookUrl: string;
  masterChatId: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    internalApiKey: requireEnv("INTERNAL_API_KEY"),
    n8nWebhookUrl: requireEnv("N8N_WEBHOOK_URL"),
    masterChatId: parseMasterChatId(requireEnv("MASTER_CHAT_ID")),
  };
}

function parseMasterChatId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("MASTER_CHAT_ID must be an integer");
  }
  return parsed;
}
