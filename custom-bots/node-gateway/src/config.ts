import { z } from "zod";
import { asChatId, type ChatId } from "./domain.js";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  INTERNAL_API_KEY: z.string().min(1),
  N8N_WEBHOOK_URL: z.string().min(1),
  N8N_WEBHOOK_SECRET: z.string().min(1),
  MASTER_CHAT_ID: z
    .string()
    .regex(/^-?\d+$/u, { message: "MASTER_CHAT_ID must be integer string" }),
  VOICE_BASE64_MAX_BYTES: z
    .string()
    .regex(/^\d+$/u)
    .transform((v) => Number(v))
    .optional(),
  OUTBOX_PROCESSED_TTL_HOURS: z
    .string()
    .regex(/^\d+$/u)
    .transform((v) => Number(v))
    .optional(),
  OUTBOX_POLL_INTERVAL_MS: z
    .string()
    .regex(/^\d+$/u)
    .transform((v) => Number(v))
    .optional(),
  OUTBOX_BATCH_SIZE: z
    .string()
    .regex(/^\d+$/u)
    .transform((v) => Number(v))
    .optional(),
  OUTBOX_MAX_RETRIES: z
    .string()
    .regex(/^\d+$/u)
    .transform((v) => Number(v))
    .optional(),
});

export interface AppConfig {
  readonly telegramBotToken: string;
  readonly databaseUrl: string;
  readonly internalApiKey: string;
  readonly n8nWebhookUrl: string;
  readonly n8nWebhookSecret: string;
  readonly masterChatId: ChatId;
  readonly voiceBase64MaxBytes: number;
  readonly outboxProcessedTtlHours: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxRetries: number;
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    databaseUrl: parsed.DATABASE_URL,
    internalApiKey: parsed.INTERNAL_API_KEY,
    n8nWebhookUrl: parsed.N8N_WEBHOOK_URL,
    n8nWebhookSecret: parsed.N8N_WEBHOOK_SECRET,
    masterChatId: asChatId(Number(parsed.MASTER_CHAT_ID)),
    voiceBase64MaxBytes: parsed.VOICE_BASE64_MAX_BYTES ?? 2_000_000,
    outboxProcessedTtlHours: parsed.OUTBOX_PROCESSED_TTL_HOURS ?? 72,
    outboxPollIntervalMs: parsed.OUTBOX_POLL_INTERVAL_MS ?? 5_000,
    outboxBatchSize: parsed.OUTBOX_BATCH_SIZE ?? 10,
    outboxMaxRetries: parsed.OUTBOX_MAX_RETRIES ?? 5,
  };
}
