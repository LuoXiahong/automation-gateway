import { Telegraf, Context, Markup } from "telegraf";
import { AppConfig } from "./config.js";
import { HttpClient } from "./httpClient.js";
import { AllowedChatRepository, UserStateRepository } from "./db.js";

/** Callback data for menu buttons (prefix menu: to avoid collisions). */
export const MENU_CB = {
  IMPULS: "menu:impuls",
  ALLOW_HERE: "menu:allow_here",
  REVOKE_HERE: "menu:revoke_here",
  ALLOWED_LIST: "menu:allowed_list",
} as const;

export interface BotDependencies {
  config: AppConfig;
  userStateRepository: UserStateRepository;
  allowedChatRepository: AllowedChatRepository;
  httpClient: HttpClient;
}

export async function handleUserTextMessage(
  ctx: Context,
  deps: BotDependencies,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message && "text" in ctx.message ? ctx.message.text : null;

  if (!chatId || text === null) {
    return;
  }

  const currentState = await deps.userStateRepository.getUserState(chatId);

  if (currentState === "awaiting_plan") {
    try {
      const response = await deps.httpClient.post(
        deps.config.n8nWebhookUrl,
        {
          chatId,
          text,
        },
      );

      if (!response.ok) {
        await ctx.reply(
          "System planowania jest chwilowo niedostępny. Spróbuj proszę ponownie za kilka minut.",
        );
        return;
      }

      await deps.userStateRepository.setUserState(chatId, "default");
      await ctx.reply("Dzięki, przekazuję Twój plan do systemu.");
    } catch {
      await ctx.reply(
        "Nie udało się teraz przekazać planu do systemu. Spróbuj ponownie później.",
      );
    }
  }
}

export async function authorizeContext(
  ctx: Context,
  deps: Pick<BotDependencies, "config" | "allowedChatRepository">,
  next: () => Promise<void>,
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
    // eslint-disable-next-line no-console
    console.warn(
      `Blocked unauthorized access from user ${fromId} in chat ${chatId}`,
    );
    return;
  }

  await next();
}

export async function handleImpulsCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "userStateRepository">,
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
}

export async function handleAllowHereCommand(
  ctx: Context,
  deps: Pick<
    BotDependencies,
    "config" | "allowedChatRepository"
  >,
): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!fromId || fromId !== deps.config.masterChatId || !chatId) {
    return;
  }

  await deps.allowedChatRepository.allowChat(chatId);
  await ctx.reply(
    `Ten chat (${chatId}) został dodany do whitelisty dostępu.`,
  );
}

export async function handleRevokeHereCommand(
  ctx: Context,
  deps: Pick<
    BotDependencies,
    "config" | "allowedChatRepository"
  >,
): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!fromId || fromId !== deps.config.masterChatId || !chatId) {
    return;
  }

  await deps.allowedChatRepository.revokeChat(chatId);
  await ctx.reply(
    `Ten chat (${chatId}) został usunięty z whitelisty dostępu.`,
  );
}

export async function handleAllowedListCommand(
  ctx: Context,
  deps: Pick<
    BotDependencies,
    "config" | "allowedChatRepository"
  >,
): Promise<void> {
  const fromId = ctx.from?.id;

  if (!fromId || fromId !== deps.config.masterChatId) {
    return;
  }

  const allowedChats = await deps.allowedChatRepository.listAllowedChats();

  if (allowedChats.length === 0) {
    await ctx.reply(
      "Brak dopuszczonych chatów (poza ownerem wskazanym przez MASTER_CHAT_ID).",
    );
    return;
  }

  const formatted = allowedChats.map((id) => `- ${id}`).join("\n");
  await ctx.reply(
    `Aktualna whitelist'a czatów (bez MASTER_CHAT_ID):\n${formatted}`,
  );
}

const START_WELCOME =
  "Witaj! Wybierz akcję z menu poniżej lub wpisz komendę (np. /impuls).";

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
      [Markup.button.callback("📋 Lista whitelist", MENU_CB.ALLOWED_LIST)],
    );
  }
  return Markup.inlineKeyboard(rows);
}

export async function handleStartCommand(
  ctx: Context,
  deps: Pick<BotDependencies, "config">,
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

  return bot;
}

