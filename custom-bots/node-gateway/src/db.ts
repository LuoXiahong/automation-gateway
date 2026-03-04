import { Pool } from "pg";

export interface UserStateRepository {
  getUserState(userId: number): Promise<string>;
  setUserState(userId: number, newState: string): Promise<void>;
}

export interface AllowedChatRepository {
  isAllowed(chatId: number): Promise<boolean>;
  allowChat(chatId: number): Promise<void>;
  revokeChat(chatId: number): Promise<void>;
  listAllowedChats(): Promise<number[]>;
}

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
}

export function createUserStateRepository(pool: Pool): UserStateRepository {
  return {
    async getUserState(userId: number): Promise<string> {
      const result = await pool.query<{
        current_state: string;
      }>("SELECT current_state FROM user_states WHERE user_id = $1", [userId]);
      if (result.rows.length === 0) {
        return "default";
      }
      return result.rows[0].current_state;
    },
    async setUserState(userId: number, newState: string): Promise<void> {
      await pool.query(
        `
        INSERT INTO user_states (user_id, current_state, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET current_state = EXCLUDED.current_state, updated_at = NOW();
      `,
        [userId, newState],
      );
    },
  };
}

export function createAllowedChatRepository(pool: Pool): AllowedChatRepository {
  return {
    async isAllowed(chatId: number): Promise<boolean> {
      const result = await pool.query<{ chat_id: string }>(
        "SELECT chat_id FROM allowed_chats WHERE chat_id = $1",
        [chatId],
      );
      return result.rows.length > 0;
    },

    async allowChat(chatId: number): Promise<void> {
      await pool.query(
        `
        INSERT INTO allowed_chats (chat_id, created_at)
        VALUES ($1, NOW())
        ON CONFLICT (chat_id) DO NOTHING;
      `,
        [chatId],
      );
    },

    async revokeChat(chatId: number): Promise<void> {
      await pool.query("DELETE FROM allowed_chats WHERE chat_id = $1", [
        chatId,
      ]);
    },

    async listAllowedChats(): Promise<number[]> {
      const result = await pool.query<{ chat_id: string }>(
        "SELECT chat_id FROM allowed_chats ORDER BY chat_id ASC",
      );
      return result.rows.map((row) => Number(row.chat_id));
    },
  };
}

