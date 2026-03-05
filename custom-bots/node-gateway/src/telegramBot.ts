/** Backward-compat re-export; canonical definition in interfaces/telegramBot. */
export {
  MENU_CB,
  createBot,
  handleUserTextMessage,
  handleUserVoiceMessage,
  authorizeContext,
  handleImpulsCommand,
  handleAllowHereCommand,
  handleRevokeHereCommand,
  handleAllowedListCommand,
  handleStartCommand,
} from "./interfaces/telegramBot.js";
export type { BotDependencies } from "./interfaces/telegramBot.js";
