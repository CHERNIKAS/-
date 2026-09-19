import { and, eq, inArray, isNull } from "drizzle-orm";
import { CURRENCY_SYMBOL, type Currency } from "../currencies.js";
import { totalUsd } from "./analytics.js";
import { db, schema } from "./db.js";
import { ledgersOf } from "./ledgers.js";
import { rateToUsd } from "./rates.js";
import type { AppUser } from "./users.js";

/**
 * Итог дня — сообщение, которое бот присылает в полночь за прошедший день.
 *
 * Сообщение запоминается вместе с днём: если трату за этот день потом поправили
 * или удалили, итог переписывается, а не остаётся старой цифрой. Раньше
 * исправленная трата на 540 долларов вместо лир так и висела итогом в $578.
 */

const NL = String.fromCharCode(10);

function money(amount: number, currency: Currency): string {
  const digits = Math.abs(amount) < 10 && amount !== 0 ? 2 : 0;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  return `${CURRENCY_SYMBOL[currency]}${formatted}`;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Текст итога дня по всем книгам человека.
 *
 * По всем книгам, а не по открытой: трата в «чайной» — тоже трата дня, и
 * «итог $0» при ней выглядит как враньё.
 */
export async function daySummaryText(user: AppUser, day: string): Promise<{ text: string; totalUsd: number }> {
  const base = user.currency as Currency;
  const rate = await rateToUsd(base, day);
  const books = [];

  for (const book of await ledgersOf(user.id)) {
    const usd = await totalUsd(book.id, { from: day, to: day, label: day });
    books.push({ title: book.kind === "personal" ? "Личное" : book.title, usd });
  }

  const total = books.reduce((sum, b) => sum + b.usd, 0);
  const lines = [`<i>Итог дня</i>`, `<code>${money(total / rate, base)}</code>`];

  const spent = books.filter((b) => b.usd > 0);
  if (spent.length > 1) {
    for (const book of spent) {
      lines.push(`<i>${escape(book.title)}</i> <code>${money(book.usd / rate, base)}</code>`);
    }
  }

  return { text: lines.join(NL), totalUsd: total };
}

/** Запомнить отправленный итог: по нему он потом и переписывается. */
export async function rememberDaySummary(
  userId: number,
  chatId: string,
  messageId: number,
  day: string,
): Promise<void> {
  await db
    .insert(schema.botMessages)
    .values({ userId, chatId, messageId, kind: "summary", summaryDay: day })
    .onConflictDoNothing();
}

export type EditMessage = (chatId: string, messageId: number, text: string) => Promise<unknown>;

/**
 * Переписать итоги за дни, которых коснулась правка.
 *
 * Трогает только дни, за которые итог уже отправлялся. Ошибка Telegram (текст
 * не изменился, сообщение удалено) не мешает сохранению траты — её глотаем.
 */
export async function refreshDaySummaries(
  user: AppUser,
  days: Iterable<string>,
  edit: EditMessage,
): Promise<void> {
  const unique = [...new Set(days)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (unique.length === 0) return;

  const sent = await db.query.botMessages.findMany({
    where: and(
      eq(schema.botMessages.userId, user.id),
      eq(schema.botMessages.kind, "summary"),
      inArray(schema.botMessages.summaryDay, unique),
      isNull(schema.botMessages.cleanedAt),
    ),
  });

  for (const message of sent) {
    if (message.summaryDay === null) continue;
    const { text } = await daySummaryText(user, message.summaryDay);
    await edit(String(message.chatId), message.messageId, text).catch(() => undefined);
  }
}
