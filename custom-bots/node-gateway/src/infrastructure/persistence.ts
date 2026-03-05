import { Pool } from "pg";
import { asChatId, chatIdToNumber, type ChatId } from "../domain.js";
import type { N8nWebhookPayload } from "./httpClient.js";
import type {
  AllowedChatRepository,
  EnqueuePlanInput,
  OutboxEventRow,
  OutboxRepository,
  ScheduleRetryParams,
  UserStateRepository,
} from "../application/ports.js";

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_states (
      user_id BIGINT PRIMARY KEY,
      current_state VARCHAR(255) DEFAULT 'default',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS allowed_chats (
      chat_id BIGINT PRIMARY KEY,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id UUID PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      chat_id BIGINT NOT NULL,
      payload_json JSONB NOT NULL,
      correlation_id UUID NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_error TEXT,
      failure_class VARCHAR(32),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMP,
      failed_at TIMESTAMP,
      CONSTRAINT outbox_events_status_check CHECK (
        status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter')
      )
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbox_events_status_next_attempt_at
    ON outbox_events (status, next_attempt_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbox_events_processed_at
    ON outbox_events (processed_at);
  `);
}

export function createUserStateRepository(pool: Pool): UserStateRepository {
  return {
    async getUserState(chatId: ChatId): Promise<string> {
      const result = await pool.query<{
        current_state: string;
      }>("SELECT current_state FROM user_states WHERE user_id = $1", [chatIdToNumber(chatId)]);
      if (result.rows.length === 0) {
        return "default";
      }
      return result.rows[0].current_state;
    },
    async setUserState(chatId: ChatId, newState: string): Promise<void> {
      await pool.query(
        `
        INSERT INTO user_states (user_id, current_state, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET current_state = EXCLUDED.current_state, updated_at = NOW();
      `,
        [chatIdToNumber(chatId), newState]
      );
    },
  };
}

export function createAllowedChatRepository(pool: Pool): AllowedChatRepository {
  return {
    async isAllowed(chatId: ChatId): Promise<boolean> {
      const result = await pool.query<{ chat_id: string }>(
        "SELECT chat_id FROM allowed_chats WHERE chat_id = $1",
        [chatIdToNumber(chatId)]
      );
      return result.rows.length > 0;
    },

    async allowChat(chatId: ChatId): Promise<void> {
      await pool.query(
        `
        INSERT INTO allowed_chats (chat_id, created_at)
        VALUES ($1, NOW())
        ON CONFLICT (chat_id) DO NOTHING;
      `,
        [chatIdToNumber(chatId)]
      );
    },

    async revokeChat(chatId: ChatId): Promise<void> {
      await pool.query("DELETE FROM allowed_chats WHERE chat_id = $1", [chatIdToNumber(chatId)]);
    },

    async listAllowedChats(): Promise<readonly ChatId[]> {
      const result = await pool.query<{ chat_id: string }>(
        "SELECT chat_id FROM allowed_chats ORDER BY chat_id ASC"
      );
      return result.rows.map((row) => asChatId(Number(row.chat_id)));
    },
  };
}

export function createOutboxRepository(pool: Pool): OutboxRepository {
  return {
    async enqueuePlanAndSetDefaultState(input: EnqueuePlanInput): Promise<{ eventId: string }> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertResult = await client.query<{ id: string }>(
          `
            INSERT INTO outbox_events (
              id,
              event_type,
              chat_id,
              payload_json,
              correlation_id,
              status,
              attempt_count,
              next_attempt_at,
              created_at
            )
            VALUES ($1::uuid, 'user_plan_submitted', $2, $3::jsonb, $4::uuid, 'pending', 0, NOW(), NOW())
            RETURNING id;
          `,
          [
            input.eventId,
            chatIdToNumber(input.chatId),
            JSON.stringify(input.payload),
            input.correlationId,
          ]
        );

        await client.query(
          `
            INSERT INTO user_states (user_id, current_state, updated_at)
            VALUES ($1, 'default', NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET current_state = 'default', updated_at = NOW();
          `,
          [chatIdToNumber(input.chatId)]
        );

        await client.query("COMMIT");
        return { eventId: insertResult.rows[0].id };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getPendingBatch(batchSize: number): Promise<OutboxEventRow[]> {
      const result = await pool.query<{
        id: string;
        chat_id: string;
        payload_json: unknown;
        correlation_id: string;
        attempt_count: string;
      }>(
        `
          WITH claimed AS (
            SELECT id FROM outbox_events
            WHERE status = 'pending' AND next_attempt_at <= NOW()
            ORDER BY created_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE outbox_events SET status = 'processing'
          WHERE id IN (SELECT id FROM claimed)
          RETURNING id, chat_id, payload_json, correlation_id, attempt_count;
        `,
        [batchSize]
      );
      return result.rows.map((row) => ({
        id: row.id,
        chat_id: asChatId(Number(row.chat_id)),
        payload_json: row.payload_json as N8nWebhookPayload,
        correlation_id: row.correlation_id,
        attempt_count: Number(row.attempt_count),
      }));
    },

    async markProcessed(id: string): Promise<void> {
      await pool.query(
        `UPDATE outbox_events SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
        [id]
      );
    },

    async markFailed(id: string, error: string, failureClass: string): Promise<void> {
      await pool.query(
        `UPDATE outbox_events SET status = 'failed', failed_at = NOW(), last_error = $2, failure_class = $3 WHERE id = $1::uuid`,
        [id, error, failureClass]
      );
    },

    async markDeadLetter(id: string, error: string): Promise<void> {
      await pool.query(
        `UPDATE outbox_events SET status = 'dead_letter', failed_at = NOW(), last_error = $2, failure_class = 'max_retries' WHERE id = $1::uuid`,
        [id, error]
      );
    },

    async scheduleRetry(params: ScheduleRetryParams): Promise<void> {
      await pool.query(
        `UPDATE outbox_events SET status = 'pending', attempt_count = $2, next_attempt_at = $3, last_error = $4 WHERE id = $1::uuid`,
        [params.id, params.attemptCount, params.nextAttemptAt, params.lastError]
      );
    },

    async pruneProcessedEvents(ttlHours: number): Promise<number> {
      const result = await pool.query<{ id: string }>(
        `DELETE FROM outbox_events
         WHERE status = 'processed' AND processed_at IS NOT NULL
           AND processed_at < NOW() - $1::int * interval '1 hour'
         RETURNING id`,
        [ttlHours]
      );
      return result.rowCount ?? 0;
    },
  };
}
