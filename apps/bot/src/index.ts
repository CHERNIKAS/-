import type { Currency } from "@costnote/core";
import { Bot } from "grammy";
import { env } from "./env.js";
import { moneyShort } from "./format.js";
import { handleCallback } from "./handlers/callbacks.js";
import { handleExpenseMessage } from "./handlers/expense.js";
import { mainKeyboard } from "./keyboards.js";
import { listCategories, totalSince } from "./repo/expenses.js";
import { rateToUsd, refreshRates, today } from "./repo/rates.js";
import { ensureUser } from "./repo/users.js";

const bot = new Bot(env.BOT_TOKEN);

bot.catch((err) => {
  console.error("ошибка в обработчике:", err.error);
});

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  await ensureUser(ctx.from);

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
      "<b>Команды</b>",
      "/day — сколько потрачено сегодня",
      "/month — сколько за месяц",
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

async function summary(ctx: Parameters<Parameters<typeof bot.command>[1]>[0], fromDay: string, label: string) {
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

bot.hears("Аналитика", (ctx) => ctx.reply("Аналитика будет в следующей версии."));

bot.on("callback_query:data", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await handleCallback(ctx, user, ledgerId);
});

bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const { user, ledgerId } = await ensureUser(ctx.from);
  await handleExpenseMessage(ctx, user, ledgerId, ctx.msg.text);
});

async function main() {
  await bot.api.setMyCommands([
    { command: "day", description: "Сколько сегодня" },
    { command: "month", description: "Сколько за месяц" },
    { command: "help", description: "Как писать траты" },
  ]);

  // Курсы нужны для первой же траты в чужой валюте — тянем на старте, а не
  // ждём ночного расписания.
  try {
    await refreshRates();
  } catch (error) {
    console.error("курсы не обновились:", error);
  }

  console.log("бот запущен");
  await bot.start();
}

void main();
