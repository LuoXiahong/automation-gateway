/**
 * Domain types (opaque/branded) to avoid primitive obsession.
 * Construction is allowed only at boundaries; use parse/validate there and pass these types inward.
 */

declare const __brand: unique symbol;

/** Telegram chat identifier. Use asChatId at boundaries (e.g. ctx.chat?.id, parsed payload). */
export type ChatId = number & { readonly [__brand]: "ChatId" };

/** Telegram user identifier. Use asUserId at boundaries. */
export type UserId = number & { readonly [__brand]: "UserId" };

export function asChatId(value: number): ChatId {
  if (!Number.isInteger(value)) {
    throw new Error("ChatId must be an integer");
  }
  return value as ChatId;
}

export function asUserId(value: number): UserId {
  if (!Number.isInteger(value)) {
    throw new Error("UserId must be an integer");
  }
  return value as UserId;
}

/** Unwrap for storage/API where a raw number is required (e.g. Telegram API, DB). */
export function chatIdToNumber(chatId: ChatId): number {
  return chatId as number;
}

export function userIdToNumber(userId: UserId): number {
  return userId as number;
}
