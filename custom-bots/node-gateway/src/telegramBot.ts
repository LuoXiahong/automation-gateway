import { Telegraf, Context, Markup } from "telegraf";
import { randomUUID } from "crypto";
import { AppConfig } from "./config.js";
import { N8nWebhookPayload } from "./httpClient.js";
import { AllowedChatRepository, OutboxRepository, UserStateRepository } from "./db.js";

/** Callback data for menu buttons (prefix menu: to avoid collisions). */
export const MENU_CB = {
  IMPULS: "menu:impuls",
  ALLOW_HERE: "menu:allow_here",
  REVOKE_HERE: "menu:revoke_here",
  ALLOWED_LIST: "menu:allowed_list",
} as const;

const COOLDOWN_MS = 120_000;
const COOLDOWN_FINISHED_MESSAGE =
  "Czas minął. Chłodny umysł przywrócony. Jaki masz teraz plan działania?";

export interface BotDependencies {
  config: AppConfig;
  userStateRepository: UserStateRepository;
  allowedChatRepository: AllowedChatRepository;
  outboxRepository: OutboxRepository;
  downloadAudioBuffer: (url: string) => Promise<Buffer>;
}

export async function handleUserTextMessage(ctx: Context, deps: BotDependencies): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message && "text" in ctx.message ? ctx.message.text : null;

  if (!chatId || text === null) {
    return;
  }

  const currentState = await deps.userStateRepository.getUserState(chatId);

  if (currentState === "awaiting_plan") {
    try {
      const correlationId = randomUUID();
      const eventId = randomUUID();
      const payload: N8nWebhookPayload = { chatId, text };
      await deps.outboxRepository.enqueuePlanAndSetDefaultState({
        eventId,
        chatId,
        correlationId,
        payload,
      });
      await ctx.reply("Dzięki, przekazuję Twój plan do systemu.");
    } catch {
      await ctx.reply("Nie udało się teraz przekazać planu do systemu. Spróbuj ponownie później.");
    }
  }
}

export async function handleUserVoiceMessage(ctx: Context, deps: BotDependencies): Promise<void> {
  const chatId = ctx.chat?.id;
  const voice = ctx.message && "voice" in ctx.message ? ctx.message.voice : null;

  if (!chatId || !voice?.file_id) {
    return;
  }

  const currentState = await deps.userStateRepository.getUserState(chatId);

  if (currentState !== "awaiting_plan") {
    return;
  }

  try {
    const fileSizeBytes = await resolveVoiceFileSizeBytes(ctx, voice.file_id, voice.file_size);
    if (!fileSizeBytes || fileSizeBytes > deps.config.voiceBase64MaxBytes) {
      await ctx.reply("Notatka głosowa jest zbyt duża. Wyślij krótszą wiadomość głosową.");
      return;
    }

    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const fileUrl = typeof fileLink === "string" ? fileLink : fileLink.href;
    const fileBuffer = await deps.downloadAudioBuffer(fileUrl);

    const payload: N8nWebhookPayload = {
      chatId,
      text: "[VOICE]",
      voiceBase64: fileBuffer.toString("base64"),
      voiceMimeType: "audio/ogg",
      voiceDurationSeconds: voice.duration,
    };
    const correlationId = randomUUID();
    const eventId = randomUUID();
    await deps.outboxRepository.enqueuePlanAndSetDefaultState({
      eventId,
      chatId,
      correlationId,
      payload,
    });
    await ctx.reply("Dzięki, przekazuję Twój plan do systemu.");
  } catch {
    await ctx.reply("Nie udało się teraz przekazać planu do systemu. Spróbuj ponownie później.");
  }
}

interface TelegramFileInfo {
  file_size?: number;
}

async function resolveVoiceFileSizeBytes(
  ctx: Context,
  fileId: string,
  voiceMessageFileSize?: number
): Promise<number | null> {
  if (typeof voiceMessageFileSize === "number" && voiceMessageFileSize > 0) {
    return voiceMessageFileSize;
  }

  const fileInfo = (await ctx.telegram.getFile(fileId)) as TelegramFileInfo;
  if (typeof fileInfo.file_size === "number" && fileInfo.file_size > 0) {
    return fileInfo.file_size;
  }
  return null;
}

export async function authorizeContext(
  ctx: Context,
  deps: Pick<BotDependencies, "config" | "allowedChatRepository">,
  next: () => Promise<void>
): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!fromId || !chatId) {
    return;
  }

  if (fromId === deps.config.masterChatId) {
    await next();
    return;
  }

  const isAllowed = await deps.allowedChatRepository.isAllowed(chatId);
  if (!isAllowed) {
    console.warn(`Blocked unauthorized access from user ${fromId} in chat ${chatId}`);
    return;
  }

  await next();
}

export async function handleImpulsCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "userStateRepository">
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }

  const message =
    "Złapmy dystans. Odczekaj 120 sekund zanim podejmiesz decyzję. " +
    "Oddychaj spokojnie, a po tym czasie wróć i napisz, jaki plan działania wybierasz.";

  await ctx.reply(message);
  await deps.userStateRepository.setUserState(chatId, "cooling_down_120s");

  setTimeout(() => {
    void (async () => {
      try {
        await ctx.telegram.sendMessage(chatId, COOLDOWN_FINISHED_MESSAGE);
        await deps.userStateRepository.setUserState(chatId, "awaiting_plan");
      } catch (err) {
        console.error("Impuls cooldown timer failed:", err);
        throw err;
      }
    })();
  }, COOLDOWN_MS);
}

export async function handleAllowHereCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "config" | "allowedChatRepository">
): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!fromId || fromId !== deps.config.masterChatId || !chatId) {
    return;
  }

  await deps.allowedChatRepository.allowChat(chatId);
  await ctx.reply(`Ten chat (${chatId}) został dodany do whitelisty dostępu.`);
}

export async function handleRevokeHereCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "config" | "allowedChatRepository">
): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!fromId || fromId !== deps.config.masterChatId || !chatId) {
    return;
  }

  await deps.allowedChatRepository.revokeChat(chatId);
  await ctx.reply(`Ten chat (${chatId}) został usunięty z whitelisty dostępu.`);
}

export async function handleAllowedListCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "config" | "allowedChatRepository">
): Promise<void> {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== deps.config.masterChatId) {
    return;
  }

  const allowedChats = await deps.allowedChatRepository.listAllowedChats();

  if (allowedChats.length === 0) {
    await ctx.reply("Brak dopuszczonych chatów (poza ownerem wskazanym przez MASTER_CHAT_ID).");
    return;
  }

  const formatted = allowedChats.map((id) => `- ${id}`).join("\n");
  await ctx.reply(`Aktualna whitelist'a czatów (bez MASTER_CHAT_ID):\n${formatted}`);
}

const START_WELCOME = "Witaj! Wybierz akcję z menu poniżej lub wpisz komendę (np. /impuls).";

function getStartMenuKeyboard(isMaster: boolean): ReturnType<typeof Markup.inlineKeyboard> {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback("🧘 Złap dystans (Impuls)", MENU_CB.IMPULS)],
  ];
  if (isMaster) {
    rows.push(
      [
        Markup.button.callback("✅ Allow here", MENU_CB.ALLOW_HERE),
        Markup.button.callback("❌ Revoke here", MENU_CB.REVOKE_HERE),
      ],
      [Markup.button.callback("📋 Lista whitelist", MENU_CB.ALLOWED_LIST)]
    );
  }
  return Markup.inlineKeyboard(rows);
}

export async function handleStartCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "config">
): Promise<void> {
  const fromId = ctx.from?.id;
  if (!fromId) {
    return;
  }
  const isMaster = fromId === deps.config.masterChatId;
  const keyboard = getStartMenuKeyboard(isMaster);
  await ctx.reply(START_WELCOME, keyboard);
}

export function createBot(deps: BotDependencies): Telegraf<Context> {
  const bot = new Telegraf<Context>(deps.config.telegramBotToken);

  bot.use(async (ctx, next) => {
    await authorizeContext(ctx, deps, next);
  });

  bot.command("start", async (ctx) => {
    await handleStartCommand(ctx, { config: deps.config });
  });

  bot.command("impuls", async (ctx) => {
    await handleImpulsCommand(ctx, {
      userStateRepository: deps.userStateRepository,
    });
  });

  bot.action(MENU_CB.IMPULS, async (ctx) => {
    await ctx.answerCbQuery();
    await handleImpulsCommand(ctx, {
      userStateRepository: deps.userStateRepository,
    });
  });
  bot.action(MENU_CB.ALLOW_HERE, async (ctx) => {
    await ctx.answerCbQuery();
    await handleAllowHereCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });
  bot.action(MENU_CB.REVOKE_HERE, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRevokeHereCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });
  bot.action(MENU_CB.ALLOWED_LIST, async (ctx) => {
    await ctx.answerCbQuery();
    await handleAllowedListCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });

  bot.command("allow_here", async (ctx) => {
    await handleAllowHereCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });

  bot.command("revoke_here", async (ctx) => {
    await handleRevokeHereCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });

  bot.command("allowed_list", async (ctx) => {
    await handleAllowedListCommand(ctx, {
      config: deps.config,
      allowedChatRepository: deps.allowedChatRepository,
    });
  });

  bot.on("text", async (ctx) => {
    await handleUserTextMessage(ctx, deps);
  });

  bot.on("voice", async (ctx) => {
    await handleUserVoiceMessage(ctx, deps);
  });

  return bot;
}
