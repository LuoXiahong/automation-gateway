export interface AppConfig {
  telegramBotToken: string;
  databaseUrl: string;
  internalApiKey: string;
  n8nWebhookUrl: string;
  n8nWebhookSecret: string;
  masterChatId: number;
  voiceBase64MaxBytes: number;
  outboxProcessedTtlHours: number;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  outboxMaxRetries: number;
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
    n8nWebhookSecret: requireEnv("N8N_WEBHOOK_SECRET"),
    masterChatId: parseMasterChatId(requireEnv("MASTER_CHAT_ID")),
    voiceBase64MaxBytes: parsePositiveIntEnv("VOICE_BASE64_MAX_BYTES", 2_000_000),
    outboxProcessedTtlHours: parsePositiveIntEnv("OUTBOX_PROCESSED_TTL_HOURS", 72),
    outboxPollIntervalMs: parsePositiveIntEnv("OUTBOX_POLL_INTERVAL_MS", 5_000),
    outboxBatchSize: parsePositiveIntEnv("OUTBOX_BATCH_SIZE", 10),
    outboxMaxRetries: parsePositiveIntEnv("OUTBOX_MAX_RETRIES", 5),
  };
}

function parseMasterChatId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("MASTER_CHAT_ID must be an integer");
  }
  return parsed;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
