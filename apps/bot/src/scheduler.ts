import type { Currency } from "@costnote/core";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Api, Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db, schema } from "./db.js";
import { moneyShort } from "./format.js";
import { totalSince } from "./repo/expenses.js";
import { rateToUsd, refreshRates } from "./repo/rates.js";
import { pendingSuggestions } from "./repo/suggestions.js";
import type { AppUser } from "./repo/users.js";

/**
 * Всё, что бот делает сам.
 *
 * Расписание считается в часовом поясе каждого пользователя, а не сервера:
 * «девять вечера» должно быть девятью вечера у человека. Поэтому вместо
 * одного ночного запуска здесь короткий тик раз в десять минут, который
 * смотрит, у кого сейчас нужный час.
 */

const TICK_MS = 10 * 60 * 1000;

/** Локальная дата пользователя в формате YYYY-MM-DD. */
export function localDay(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function localHour(timezone: string, now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(
      now,
    ),
  );
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function personalLedgerId(userId: number): Promise<number | null> {
  const ledger = await db.query.ledgers.findFirst({
    where: and(eq(schema.ledgers.ownerId, userId), eq(schema.ledgers.isShared, false)),
  });
  return ledger?.id ?? null;
}

/**
 * Вечернее напоминание.
 *
 * Приходит, только если за день ничего не внесено: спрашивать «трат не было?»
 * у человека, который сегодня уже что-то записал, бессмысленно.
 */
async function runReminders(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (!user.reminderEnabled) continue;

    const day = localDay(user.timezone, now);
    if (user.lastReminderDay === day) continue;
    if (localHour(user.timezone, now) !== user.reminderHour) continue;

    const ledgerId = await personalLedgerId(user.id);
    if (ledgerId === null) continue;

    const spentToday = await totalSince(ledgerId, day);
    await db
      .update(schema.users)
      .set({ lastReminderDay: day })
      .where(eq(schema.users.id, user.id));

    if (spentToday > 0) continue;

    await api
      .sendMessage(user.tgId, "Сегодня трат не было. Правда ноль?", {
        reply_markup: new InlineKeyboard()
          .text("Да, ноль", `z:ask:${day}`)
          .text("Внести", "z:skip"),
      })
      .catch(() => undefined);
  }
}

/**
 * Уборка карточек за прошлые дни.
 *
 * Telegram разрешает боту удалять сообщения только 48 часов, поэтому уборка
 * ежесуточная: раз в неделю удалять было бы уже нечего.
 */
async function runCleanup(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (!user.dailyCleanup) continue;
    if (localHour(user.timezone, now) !== 0) continue;

    const day = localDay(user.timezone, now);
    const yesterday = shiftDay(day, 1);

    const cards = await db.query.botMessages.findMany({
      where: and(
        eq(schema.botMessages.userId, user.id),
        eq(schema.botMessages.kind, "card"),
        isNull(schema.botMessages.cleanedAt),
        lt(schema.botMessages.createdAt, new Date(`${day}T00:00:00Z`)),
      ),
      limit: 100,
    });

    if (cards.length === 0) continue;

    for (const card of cards) {
      await api.deleteMessage(card.chatId, card.messageId).catch(() => undefined);
      await db
        .update(schema.botMessages)
        .set({ cleanedAt: new Date() })
        .where(eq(schema.botMessages.id, card.id));
    }

    const ledgerId = await personalLedgerId(user.id);
    if (ledgerId === null) continue;

    const base = user.currency as Currency;
    const rate = await rateToUsd(base, yesterday);
    const total = await totalSince(ledgerId, yesterday);

    await api
      .sendMessage(
        user.tgId,
        `<i>Итог дня</i>\n<code>${moneyShort(total / rate, base)}</code>`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);
  }
}

/**
 * Предложения завести категорию.
 *
 * Раз в неделю и все накопившиеся сразу — дёргать человека по одному поводу
 * за раз значило бы растянуть разбор на месяц.
 */
async function runSuggestions(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (localHour(user.timezone, now) !== 12) continue;

    const day = localDay(user.timezone, now);
    if (user.lastSuggestionDay !== null && shiftDay(day, 6) < user.lastSuggestionDay) continue;

    const ledgerId = await personalLedgerId(user.id);
    if (ledgerId === null) continue;

    const suggestions = await pendingSuggestions(ledgerId, shiftDay(day, 30));
    await db
      .update(schema.users)
      .set({ lastSuggestionDay: day })
      .where(eq(schema.users.id, user.id));

    if (suggestions.length === 0) continue;

    const base = user.currency as Currency;
    const rate = await rateToUsd(base, day);

    const lines = ["<i>В «Прочем» накопилось похожее</i>", ""];
    const kb = new InlineKeyboard();

    for (const s of suggestions) {
      lines.push(
        `<b>${s.merchant}</b> — ${s.count} трат, <code>${moneyShort(s.totalUsd / rate, base)}</code>`,
      );
      kb.text(`Завести «${s.merchant}»`, `g:add:${encodeURIComponent(s.merchant).slice(0, 50)}`).row();
    }

    lines.push("", "<i>Завести под них отдельные категории?</i>");
    kb.text("Не надо", "g:skip");

    await api
      .sendMessage(user.tgId, lines.join("\n"), { parse_mode: "HTML", reply_markup: kb })
      .catch(() => undefined);
  }
}

export function startScheduler(bot: Bot): void {
  let ratesDay = "";

  const tick = async () => {
    const now = new Date();

    try {
      const utcDay = now.toISOString().slice(0, 10);
      if (ratesDay !== utcDay) {
        await refreshRates();
        ratesDay = utcDay;
      }
    } catch (error) {
      console.error("курсы не обновились:", error);
    }

    try {
      // Пользователей мало, а условий у каждой задачи свои, поэтому берём всех
      // и фильтруем внутри — так проще, чем собирать составной запрос.
      const users = await db.query.users.findMany();

      await runReminders(bot.api, users, now);
      await runCleanup(bot.api, users, now);
      await runSuggestions(bot.api, users, now);
    } catch (error) {
      console.error("тик планировщика упал:", error);
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_MS);
}
