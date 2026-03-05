import type { ChatId } from "../domain.js";
import type { N8nWebhookPayload } from "../infrastructure/httpClient.js";

export interface ScheduleRetryParams {
  readonly id: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date;
  readonly lastError: string;
}

export interface UserStateRepository {
  getUserState(chatId: ChatId): Promise<string>;
  setUserState(chatId: ChatId, newState: string): Promise<void>;
}

export interface AllowedChatRepository {
  isAllowed(chatId: ChatId): Promise<boolean>;
  allowChat(chatId: ChatId): Promise<void>;
  revokeChat(chatId: ChatId): Promise<void>;
  listAllowedChats(): Promise<readonly ChatId[]>;
}

export interface EnqueuePlanInput {
  readonly eventId: string;
  readonly chatId: ChatId;
  readonly correlationId: string;
  readonly payload: N8nWebhookPayload;
}

export interface OutboxEventRow {
  readonly id: string;
  readonly chat_id: ChatId;
  readonly payload_json: N8nWebhookPayload;
  readonly correlation_id: string;
  readonly attempt_count: number;
}

export interface OutboxRepository {
  enqueuePlanAndSetDefaultState(input: EnqueuePlanInput): Promise<{ eventId: string }>;
  getPendingBatch(batchSize: number): Promise<OutboxEventRow[]>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string, failureClass: string): Promise<void>;
  markDeadLetter(id: string, error: string): Promise<void>;
  scheduleRetry(params: ScheduleRetryParams): Promise<void>;
  pruneProcessedEvents(ttlHours: number): Promise<number>;
}

export interface TelegramGatewayPort {
  sendMessage(chatId: ChatId, text: string): Promise<void>;
}
