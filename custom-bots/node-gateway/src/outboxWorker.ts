import type { AppConfig } from "./config.js";
import type { OutboxEventRow, OutboxRepository } from "./db.js";
import type { HttpClient } from "./httpClient.js";

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function nextAttemptAt(attemptCount: number): Date {
  const delayMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, attemptCount), MAX_BACKOFF_MS);
  return new Date(Date.now() + delayMs);
}

export interface OutboxWorkerDeps {
  config: AppConfig;
  outboxRepository: OutboxRepository;
  httpClient: HttpClient;
}

export async function runOutboxTick(deps: OutboxWorkerDeps): Promise<void> {
  const batch = await deps.outboxRepository.getPendingBatch(deps.config.outboxBatchSize);
  for (const row of batch) {
    await processOne(deps, row);
  }
}

async function processOne(deps: OutboxWorkerDeps, row: OutboxEventRow): Promise<void> {
  const headers: Record<string, string> = {
    "x-correlation-id": row.correlation_id,
    "x-webhook-secret": deps.config.n8nWebhookSecret,
    "x-idempotency-key": row.id,
  };

  try {
    const response = await deps.httpClient.post(
      deps.config.n8nWebhookUrl,
      row.payload_json,
      headers
    );

    if (response.ok) {
      await deps.outboxRepository.markProcessed(row.id);
      return;
    }

    const status = response.status;
    const bodyText = await response.text().catch(() => "");

    if (status >= 400 && status < 500) {
      await deps.outboxRepository.markFailed(
        row.id,
        `HTTP ${status}: ${bodyText.slice(0, 500)}`,
        "client_error"
      );
      return;
    }

    await scheduleRetryOrDeadLetter(deps, row, `HTTP ${status}: ${bodyText.slice(0, 200)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await scheduleRetryOrDeadLetter(deps, row, message);
  }
}

async function scheduleRetryOrDeadLetter(
  deps: OutboxWorkerDeps,
  row: OutboxEventRow,
  lastError: string
): Promise<void> {
  const nextCount = row.attempt_count + 1;
  if (nextCount > deps.config.outboxMaxRetries) {
    await deps.outboxRepository.markDeadLetter(row.id, lastError);
    return;
  }
  const at = nextAttemptAt(nextCount);
  await deps.outboxRepository.scheduleRetry({
    id: row.id,
    attemptCount: nextCount,
    nextAttemptAt: at,
    lastError,
  });
}
