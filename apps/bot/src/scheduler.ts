import { type Currency, categorize, classify, digest } from "@costnote/core";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Api, Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db, schema } from "@costnote/core/data";
import { env } from "./env.js";
import { moneyShort } from "./format.js";
import { totalSince } from "@costnote/core/data";
import { rateToUsd, refreshRates } from "@costnote/core/data";
import {
  byCategory,
  createExpense,
  listCategories,
  recentCorrections,
  setCategory,
  userRules,
  dueRecurring,
  ledgersOf,
  markCharged,
  pendingSuggestions,
  totalUsd,
} from "@costnote/core/data";
import type { AppUser } from "@costnote/core/data";

/**
 * Всё, что бот делает сам.
 *
 * Расписание считается в часовом поясе каждого пользователя, а не сервера:
 * «девять вечера» должно быть девятью вечера у человека. Поэтому вместо
 * одного ночного запуска здесь короткий тик раз в десять минут, который
 * смотрит, у кого сейчас нужный час.
 */

const NL = String.fromCharCode(10);

const TICK_MS = 10 * 60 * 1000;

/**
 * Тихие часы: ночью бот молчит.
 *
 * Всё, что должно было уйти, просто подождёт до утра — учёт расходов не та
 * тема, ради которой стоит будить человека.
 */
const QUIET_FROM = 23;
const QUIET_TO = 9;

function isQuiet(timezone: string, now: Date): boolean {
  const hour = localHour(timezone, now);
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

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
    if (isQuiet(user.timezone, now)) continue;
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
  // Уборка идёт в полночь и намеренно не смотрит на тихие часы: она ничего не
  // присылает, а удаляет вчерашние карточки.
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
    if (isQuiet(user.timezone, now)) continue;
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


/**
 * Начисление регулярных платежей.
 *
 * Утром, а не в полночь: сообщение о списании должно попасть в день, когда
 * человек его прочитает, а не потеряться среди ночных уведомлений.
 */
async function runRecurring(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (isQuiet(user.timezone, now)) continue;
    if (localHour(user.timezone, now) !== 9) continue;

    const day = localDay(user.timezone, now);
    const books = await ledgersOf(user.id);

    for (const book of books) {
      const due = await dueRecurring(book.id, day);

      for (const item of due) {
        const amount = Number(item.amount);
        const rate = await rateToUsd(item.currency as Currency, day);

        await createExpense({
          ledgerId: book.id,
          userId: user.id,
          categoryId: item.categoryId,
          amount,
          currency: item.currency as Currency,
          rateToUsd: rate,
          spentAt: day,
          merchant: item.title,
          confidence: null,
          needsReview: false,
        });

        await markCharged(item.id, day);

        await api
          .sendMessage(
            user.tgId,
            `<i>Регулярный платёж</i>${NL}<code>${moneyShort(amount, item.currency as Currency)}</code> · ${item.title}`,
            { parse_mode: "HTML" },
          )
          .catch(() => undefined);
      }
    }
  }
}


/**
 * Итог недели.
 *
 * Понедельник утром: неделя уже закончилась, а новая ещё не успела набрать
 * трат, и цифра читается как результат, а не как промежуточный счёт.
 */
async function runWeekly(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (isQuiet(user.timezone, now)) continue;
    if (localHour(user.timezone, now) !== 10) continue;

    const day = localDay(user.timezone, now);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) continue;
    if (user.lastWeeklyDay === day) continue;

    const ledgerId = await personalLedgerId(user.id);
    if (ledgerId === null) continue;

    const base = user.currency as Currency;
    const rate = await rateToUsd(base, day);
    const period = { from: shiftDay(day, 7), to: shiftDay(day, 1), label: "неделя" };
    const previous = { from: shiftDay(day, 14), to: shiftDay(day, 8), label: "прошлая" };

    const [total, before, categories] = await Promise.all([
      totalUsd(ledgerId, period),
      totalUsd(ledgerId, previous),
      byCategory(ledgerId, period),
    ]);

    await db.update(schema.users).set({ lastWeeklyDay: day }).where(eq(schema.users.id, user.id));
    if (total === 0) continue;

    const top = categories[0];
    const diff = total - before;
    const lines = [
      `<i>Прошлая неделя</i>`,
      `<code>${moneyShort(total / rate, base)}</code>`,
    ];

    if (top !== undefined) {
      lines.push(`больше всего — ${top.title}, ${moneyShort(top.totalUsd / rate, base)}`);
    }

    if (before > 0) {
      lines.push(
        diff >= 0
          ? `на ${moneyShort(diff / rate, base)} больше, чем неделей раньше`
          : `на ${moneyShort(-diff / rate, base)} меньше, чем неделей раньше`,
      );
    }

    await api
      .sendMessage(user.tgId, lines.join(NL), { parse_mode: "HTML" })
      .catch(() => undefined);
  }
}


/**
 * Доразбор трат, которые модель не осилила.
 *
 * Когда Gemini недоступен, трата всё равно сохраняется — с временной
 * категорией и флагом needs_review. Этот проход возвращается к ним и
 * досчитывает категорию, а потом сообщает об этом одним сообщением: человек
 * должен узнать, что его траты дораспределились, а не обнаружить это случайно.
 */
async function runRetry(api: Api, users: AppUser[]): Promise<void> {
  for (const user of users) {
    const books = await ledgersOf(user.id);

    for (const book of books) {
      const pending = await db.query.expenses.findMany({
        where: and(
          eq(schema.expenses.ledgerId, book.id),
          eq(schema.expenses.userId, user.id),
          eq(schema.expenses.needsReview, true),
          isNull(schema.expenses.deletedAt),
        ),
        limit: 20,
      });

      if (pending.length === 0) continue;

      const categories = await listCategories(book.id);
      const options = categories.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint }));
      const rules = await userRules(user.id);
      const corrections = await recentCorrections(user.id);
      const fixed: string[] = [];

      for (const expense of pending) {
        const merchant = expense.merchant ?? "";

        try {
          const decision = await categorize(
            {
              raw: merchant,
              merchant,
              amount: Number(expense.amount),
              currency: expense.currency as Currency,
              categories: options,
              recentCorrections: corrections,
            },
            {
              rules,
              classify: (input) =>
                classify(input, { apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL }),
            },
          );

          // Модель снова недоступна — оставляем трату до следующего прохода.
          if (decision.source === "fallback") continue;

          const category = categories.find((c) => c.slug === decision.slug);
          if (category === undefined) continue;

          await setCategory(expense.id, category.id);
          fixed.push(`${merchant === "" ? "трата" : merchant} → ${category.title}`);
        } catch {
          // Ошибка одной траты не должна ронять весь проход.
        }
      }

      if (fixed.length === 0) continue;

      await api
        .sendMessage(
          user.tgId,
          [`<i>Связь восстановилась, траты дораспределены</i>`, ...fixed].join(NL),
          { parse_mode: "HTML" },
        )
        .catch(() => undefined);
    }
  }
}


/**
 * Разбор месяца.
 *
 * Первого числа, когда месяц уже закрыт. Выключен по умолчанию: это
 * единственное, что бот пишет «от себя», и навязывать такое нельзя.
 */
async function runDigest(api: Api, users: AppUser[], now: Date): Promise<void> {
  for (const user of users) {
    if (!user.monthlyDigest) continue;
    if (isQuiet(user.timezone, now)) continue;
    if (localHour(user.timezone, now) !== 11) continue;

    const day = localDay(user.timezone, now);
    if (Number(day.slice(8, 10)) !== 1) continue;

    const month = `${day.slice(0, 7)}-01`;
    if (user.lastDigestMonth === month) continue;

    const ledgerId = await personalLedgerId(user.id);
    if (ledgerId === null) continue;

    await db.update(schema.users).set({ lastDigestMonth: month }).where(eq(schema.users.id, user.id));

    const base = user.currency as Currency;
    const rate = await rateToUsd(base, day);
    const months = await Promise.all([0, 1, 2, 3].map((back) => monthTotals(ledgerId, month, back, rate)));
    const [current, ...previous] = months;

    if (current === undefined || current.total === 0) continue;

    try {
      const notes = await digest(
        { currency: base, current, previous: previous.filter((m) => m.total > 0) },
        { apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL },
      );

      if (notes.length === 0) continue;

      await api
        .sendMessage(
          user.tgId,
          [`<i>Итоги ${current.month}</i>`, "", ...notes.map((n) => `· ${n}`)].join(NL),
          { parse_mode: "HTML" },
        )
        .catch(() => undefined);
    } catch (error) {
      console.error("разбор месяца не собрался:", error);
    }
  }
}

/** Агрегаты одного месяца: сумма и разбивка по категориям. */
async function monthTotals(
  ledgerId: number,
  currentMonthStart: string,
  monthsBack: number,
  rate: number,
) {
  const date = new Date(`${currentMonthStart}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - monthsBack - 1);

  const from = date.toISOString().slice(0, 10);
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);

  const period = { from, to, label: from.slice(0, 7) };
  const [total, categories] = await Promise.all([
    totalUsd(ledgerId, period),
    byCategory(ledgerId, period),
  ]);

  return {
    month: from.slice(0, 7),
    total: total / rate,
    byCategory: categories.map((c) => ({
      title: c.title,
      total: c.totalUsd / rate,
      count: 0,
    })),
  };
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
      await runRecurring(bot.api, users, now);
      await runWeekly(bot.api, users, now);
      await runRetry(bot.api, users);
      await runDigest(bot.api, users, now);
      await runSuggestions(bot.api, users, now);
    } catch (error) {
      console.error("тик планировщика упал:", error);
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_MS);
}
