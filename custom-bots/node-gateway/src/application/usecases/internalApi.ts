import type { ChatId } from "../../domain.js";
import type {
  AllowedChatRepository,
  TelegramGatewayPort,
  UserStateRepository,
} from "../ports.js";

export interface SendInternalMessageCommand {
  readonly chatId: ChatId;
  readonly text: string;
  readonly newState?: string;
}

export interface BroadcastStressAlertCommand {
  readonly stressValue: number;
  readonly restingHeartRate?: number;
}

export interface InternalMessageDeps {
  readonly userStateRepository: UserStateRepository;
  readonly telegramGateway: TelegramGatewayPort;
}

export interface StressAlertDeps {
  readonly masterChatId: ChatId;
  readonly allowedChatRepository: AllowedChatRepository;
  readonly userStateRepository: UserStateRepository;
  readonly telegramGateway: TelegramGatewayPort;
}

export async function handleInternalMessage(
  deps: InternalMessageDeps,
  cmd: SendInternalMessageCommand
): Promise<void> {
  await deps.telegramGateway.sendMessage(cmd.chatId, cmd.text);

  if (cmd.newState) {
    await deps.userStateRepository.setUserState(cmd.chatId, cmd.newState);
  }
}

export async function handleStressAlertBroadcast(
  deps: StressAlertDeps,
  cmd: BroadcastStressAlertCommand
): Promise<readonly ChatId[]> {
  const recipients = new Set<ChatId>();
  recipients.add(deps.masterChatId);

  const allowedChats = await deps.allowedChatRepository.listAllowedChats();
  for (const chatId of allowedChats) {
    recipients.add(chatId);
  }

  let message =
    "Uwaga: wykryto podwyższony poziom stresu " +
    `(${cmd.stressValue}). Zatrzymaj się na chwilę, ` +
    "weź kilka spokojnych oddechów i rozważ, czy potrzebujesz zmienić plan dnia.";

  if (cmd.restingHeartRate !== undefined) {
    message += ` Tętno spoczynkowe: ${cmd.restingHeartRate}.`;
  }

  for (const chatId of recipients) {
    await deps.telegramGateway.sendMessage(chatId, message);
    await deps.userStateRepository.setUserState(chatId, "awaiting_plan");
  }

  return Array.from(recipients);
}
