import type { Currency } from "@costnote/core";
import { Bot, type CommandContext, type Context, InlineKeyboard } from "grammy";
import { env } from "./env.js";
import { moneyShort } from "./format.js";
import { sendAnalytics, switchPeriod } from "./handlers/analytics.js";
import { handleSettingsCallback, settingsKeyboard, settingsText } from "./handlers/settings.js";
import { handleCallback } from "./handlers/callbacks.js";
import { handleEditedMessage, handleExpenseMessage } from "./handlers/expense.js";
import { applyImport, cancelImportFlow, handleDocument } from "./handlers/import.js";
import { mainKeyboard } from "./keyboards.js";
import { refreshPanel } from "./panel.js";
import { PERIOD_KEYS, type PeriodKey } from "@costnote/core";
import { createCategoryFromSuggestion } from "@costnote/core/data";
import { startScheduler } from "./scheduler.js";
import { listCategories, totalSince } from "@costnote/core/data";
import { rateToUsd, refreshRates, today } from "@costnote/core/data";
import {
  createSharedLedger,
  ensureUser,
  joinLedger,
  ledgerByToken,
  importById,
  ledgersOf,
  membersOf,
  undoImport,
  updateUser,
} from "@costnote/core/data";

/** Перенос строки отдельной константой — экранирование в шаблонах легко теряется. */
const NL = String.fromCharCode(10);

const bot = new Bot(env.BOT_TOKEN);

bot.catch((err) => {
  console.error("ошибка в обработчике:", err.error);
});

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);

  // Ссылка-приглашение приходит как /start join_<токен>: это штатный способ
  // Telegram передать данные при первом входе.
  const payload = ctx.match;
  if (typeof payload === "string" && payload.startsWith("join_")) {
    const ledger = await ledgerByToken(payload.slice(5));

    if (ledger) {
      await joinLedger(ledger.id, user.id);
      await updateUser(user.id, { activeLedgerId: ledger.id });
      const members = await membersOf(ledger.id);

      await ctx.reply(
        [
          `Ты в общей книге «${ledger.title}».`,
          "",
          `Участников: ${members.length}. Траты теперь пишутся сюда.`,
          "",
          "<i>Переключить обратно на личные — в настройках.</i>",
        ].join(NL),
        { parse_mode: "HTML", reply_markup: mainKeyboard },
      );
      return;
    }

    await ctx.reply("Ссылка не подошла — попроси новую.");
    return;
  }

  await ctx.reply(
    [
      "Записываю траты. Просто напиши, что потратил:",
      "",
      "<code>магаз 15 лир</code>",
      "<code>клод 20 баксов</code>",
      "<code>кофе 4.50, такси 12</code>",
      "",
      "<i>Категорию подберу сам. Если ошибусь — поправишь кнопкой, и я запомню.</i>",
    ].join("\n"),
    { parse_mode: "HTML", reply_markup: mainKeyboard },
  );

  await refreshPanel(ctx.api, user, ledgerId, String(ctx.chat.id)).catch(() => undefined);

  // Кнопка слева от поля ввода ставится каждому чату отдельно: установка по
  // умолчанию, один раз на бота, у Telegram применяется ненадёжно.
  if (env.WEBAPP_URL !== "") {
    await ctx.api
      .setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: {
          type: "web_app",
          text: "Кошелёк",
          web_app: { url: env.WEBAPP_URL },
        },
      })
      .catch(() => undefined);
  }
});

bot.command("invite", async (ctx) => {
  if (!ctx.from) return;
  const { user } = await ensureUser(ctx.from);

  const shared = (await ledgersOf(user.id)).find((l) => l.isShared);
  const ledger = shared ?? (await createSharedLedger(user));

  if (shared === undefined) await updateUser(user.id, { activeLedgerId: ledger.id });

  const link = `https://t.me/${env.BOT_USERNAME}?start=join_${ledger.inviteToken}`;
  const members = await membersOf(ledger.id);

  await ctx.reply(
    [
      `<b>${ledger.title}</b>`,
      `участников: ${members.length}`,
      "",
      "Перешли эту ссылку тому, с кем ведёшь общий бюджет:",
      link,
      "",
      "<i>Траты пишутся в общую книгу, пока не переключишь обратно в настройках.</i>",
    ].join(NL),
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "<b>Как писать траты</b>",
      "",
      "<code>магаз 15 лир</code> — сумма, валюта, название",
      "<code>такси 12 вчера</code> — можно указать день",
      "<code>кофе 4.50, аптека 30</code> — несколько сразу",
      "",
      "Валюту понимаю словами и символами: лир, tl, ₺, баксов, $, грн, ₴, евро, €.",
      "Не указал — возьму твою основную.",
      "",
      "<b>Доходы и возвраты</b>",
      "",
      "<code>+60000 лир</code> — плюс впереди означает приход",
      "<code>зарплата 2500</code> — узнаю и по слову: аванс, фриланс, премия, подарок, продал",
      "<code>возврат 15 лир</code> — погашу прошлую покупку на ту же сумму, а не запишу доход",
      "",
      "Доходы не попадают в «Потрачено» и в кольцо категорий.",
      "",
      "Выписку из банка можно просто прислать файлом — CSV, XLSX или PDF.",
      "",
      "<b>Команды</b>",
      "/day — сколько потрачено сегодня",
      "/month — сколько за месяц",
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

async function summary(ctx: CommandContext<Context>, fromDay: string, label: string) {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  const base = user.currency as Currency;
  const rate = await rateToUsd(base, today());
  const totalUsd = await totalSince(ledgerId, fromDay);

  await ctx.reply(`<i>${label}</i>\n<code>${moneyShort(totalUsd / rate, base)}</code>`, {
    parse_mode: "HTML",
  });
}

bot.command("day", (ctx) => summary(ctx, today(), "Сегодня"));
bot.command("month", (ctx) => summary(ctx, `${today().slice(0, 7)}-01`, "За месяц"));

bot.command("settings", async (ctx) => {
  if (!ctx.from) return;
  const { user } = await ensureUser(ctx.from);
  await ctx.reply(settingsText(user), {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(user),
  });
});

bot.hears("Помощь", (ctx) => ctx.reply("Напиши /help — там примеры."));

bot.hears("Категории", async (ctx) => {
  if (!ctx.from) return;
  const { ledgerId } = await ensureUser(ctx.from);
  const categories = await listCategories(ledgerId);

  await ctx.reply(
    ["<i>Твои категории</i>", ...categories.map((c) => `${c.emoji} ${c.title}`)].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.hears("Аналитика", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await sendAnalytics(ctx, user, ledgerId);
});

bot.on("callback_query:data", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  const data = ctx.callbackQuery.data;

  if (await handleSettingsCallback(ctx, user)) return;

  // Вечернее напоминание: «день без трат» подтверждается отдельным шагом,
  // чтобы случайный тап не закрыл день.
  if (data.startsWith("z:")) {
    const [, action, day] = data.split(":");

    if (action === "ask") {
      await ctx.editMessageText(`Записать ${day} как день без трат?`, {
        reply_markup: new InlineKeyboard()
          .text("Подтвердить", `z:yes:${day}`)
          .text("Отмена", "z:no"),
      });
    } else if (action === "yes") {
      await ctx.editMessageText("<i>Записано: день без трат</i>", { parse_mode: "HTML" });
    } else {
      await ctx.editMessageText("<i>Хорошо, жду трату</i>", { parse_mode: "HTML" });
    }

    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith("i:")) {
    const [, action, rawId] = data.split(":");
    const importId = Number(rawId);

    // Кнопки видны только своему импорту, но данные кнопки подделываются —
    // проверяем хозяина, а не доверяем нажатию.
    const record = await importById(importId);
    if (!record || record.userId !== user.id) {
      await ctx.answerCallbackQuery("Этот импорт уже неактуален");
      return;
    }

    if (action === "apply") {
      await applyImport(ctx, user, importId);
    } else if (action === "undo") {
      const removed = await undoImport(importId);
      await ctx.editMessageText(`<i>Импорт отменён, убрано ${removed} трат</i>`, {
        parse_mode: "HTML",
      });
      await ctx.answerCallbackQuery();
    } else {
      await cancelImportFlow(ctx, importId);
    }

    return;
  }

  if (data.startsWith("g:")) {
    const [, action, raw] = data.split(":");

    if (action === "add" && raw) {
      const merchant = decodeURIComponent(raw);
      const created = await createCategoryFromSuggestion(ledgerId, user.id, merchant);
      await ctx.editMessageText(
        created
          ? `<i>Категория «${created.title}» заведена, траты перенесены</i>`
          : "<i>Не получилось завести категорию</i>",
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.editMessageText("<i>Хорошо, оставляю как есть</i>", { parse_mode: "HTML" });
    }

    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith("a:")) {
    const key = data.slice(2) as PeriodKey;
    if (!PERIOD_KEYS.includes(key)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await switchPeriod(ctx, user, ledgerId, key);
    await ctx.answerCallbackQuery();
    return;
  }

  await handleCallback(ctx, user, ledgerId);
});

bot.on("message:document", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await handleDocument(ctx, user, ledgerId);
});

bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await handleExpenseMessage(ctx, user, ledgerId, ctx.msg.text);
});

/**
 * Правка своего сообщения перезапускает разбор.
 *
 * Человек исправляет опечатку в сумме там же, где её сделал, и ждёт, что
 * трата обновится — а не что появится вторая.
 */
bot.on("edited_message:text", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await handleEditedMessage(ctx, user, ledgerId, ctx.editedMessage.text);
});

async function main() {
  await bot.api.setMyCommands([
    { command: "day", description: "Сколько сегодня" },
    { command: "month", description: "Сколько за месяц" },
    { command: "help", description: "Как писать траты" },
    { command: "invite", description: "Общий бюджет" },
    { command: "settings", description: "Настройки" },
  ]);

  // Курсы нужны для первой же траты в чужой валюте — тянем на старте, а не
  // ждём ночного расписания.
  try {
    await refreshRates();
  } catch (error) {
    console.error("курсы не обновились:", error);
  }

  startScheduler(bot);

  console.log("бот запущен");
  await bot.start();
}

void main();
