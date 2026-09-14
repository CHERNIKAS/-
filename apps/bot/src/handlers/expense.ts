import { categorize, classify, type Currency, parseMessage, plural, resolveSpentAt } from "@costnote/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "grammy";
import { db, schema } from "@costnote/core/data";
import { localToday } from "@costnote/core/data";
import { env } from "../env.js";
import { expenseCard, incomeCard, refundCard } from "../format.js";
import { cardKeyboard } from "../keyboards.js";
import {
  categoryBySlug,
  activeLedgerId,
  applyRefund,
  createExpense,
  expensesOfMessage,
  messageRefundFingerprint,
  removeExpense,
  revertMessageRefunds,
  ledgersOf,
  findRefundTarget,
  listCategories,
  totalSince,
} from "@costnote/core/data";
import { membersOf } from "@costnote/core/data";
import { refreshPanel } from "../panel.js";
import { rateToUsd, } from "@costnote/core/data";
import { recentCorrections, userRules } from "@costnote/core/data";
import type { AppUser } from "@costnote/core/data";

/**
 * Разбор сообщения и сохранение трат.
 *
 * Порядок здесь не случаен: сначала сырой текст уходит в базу, и только потом
 * сообщение удаляется из чата. Пока запись не сделана, удалять нечего — иначе
 * при сбое посреди обработки текст пропал бы навсегда.
 */
export async function handleExpenseMessage(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  text: string,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const messageId = ctx.msg?.message_id;
  if (messageId === undefined) return;

  const inserted = await db
    .insert(schema.rawInputs)
    .values({ userId: user.id, chatId, tgMessageId: messageId, text })
    .onConflictDoNothing()
    .returning();

  // Повторная доставка вебхука или ретрай при обрыве не должны создавать
  // вторую трату: ключ (chat_id, message_id) уже занят — значит, обработано.
  if (inserted.length === 0) return;

  // Разовая запись в другую книгу: «чай: закупка 5000». Переключаться туда и
  // обратно ради одной строки — лишние два действия каждый день.
  const routed = await routeByPrefix(user, text, ledgerId);
  const entries = parseMessage(routed.text);
  const parsed = entries.filter((e) => e.ok);

  if (parsed.length === 0) {
    await ctx.reply(
      [
        "Не вижу суммы.",
        "",
        "Напиши так: <code>магаз 15 лир</code>",
        "или несколько сразу: <code>кофе 4.50, такси 12</code>",
      ].join("\n"),
      { parse_mode: "HTML" },
    );
    return;
  }

  await deleteUserMessage(ctx);
  await saveExpenses(ctx, user, routed.ledgerId, chatId, routed.text, inserted[0]?.id ?? null);
}

/**
 * Книга по префиксу перед двоеточием.
 *
 * Совпадение по началу названия: «чай:» находит «Чайный магазин». Не нашлось —
 * строка остаётся как есть, вместе с двоеточием: в тексте траты оно
 * встречается и само по себе.
 */
async function routeByPrefix(
  user: AppUser,
  text: string,
  fallbackId: number,
): Promise<{ text: string; ledgerId: number }> {
  const at = text.indexOf(":");
  if (at < 1 || at > 24) return { text, ledgerId: fallbackId };

  const prefix = text.slice(0, at).trim().toLowerCase();
  if (prefix === "") return { text, ledgerId: fallbackId };

  const books = await ledgersOf(user.id);
  const target = books.find((b) => {
    const title = (b.kind === "personal" ? "Личное" : b.title).toLowerCase();
    return title.startsWith(prefix);
  });

  if (target === undefined) return { text, ledgerId: fallbackId };

  return { text: text.slice(at + 1).trim(), ledgerId: target.id };
}

/**
 * Сохранение трат из строки.
 *
 * Вынесено отдельно, потому что тем же путём идёт повторный разбор после
 * правки сообщения — иначе логика начисления разъехалась бы на две копии.
 */
export async function saveExpenses(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  chatId: string,
  text: string,
  rawInputId: number | null = null,
): Promise<void> {
  const parsed = parseMessage(text).filter((e) => e.ok);
  if (parsed.length === 0) return;

  const categories = await listCategories(ledgerId);
  const options = categories.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint }));
  const rules = await userRules(user.id);
  const corrections = await recentCorrections(user.id);
  // «Сегодня» по поясу человека: ночная трата не должна уезжать во вчера.
  const todayDay = localToday(user.timezone);

  for (const entry of parsed) {
    const amount = entry.amount ?? 0;
    const currency = (entry.currency ?? user.currency) as Currency;
    const spentAt = resolveSpentAt(entry, todayDay);
    const base = user.currency as Currency;

    // Возврат ищет свою покупку по сумме: названия у них обычно разные, а
    // сумма — то, что их связывает. Нашлась — гасим её и ничего не создаём.
    if (entry.isRefund) {
      const target = await findRefundTarget(ledgerId, amount, currency, spentAt, entry.merchant);

      if (target !== undefined) {
        await applyRefund(
          target.id,
          amount,
          rawInputId === null ? {} : { fingerprint: messageRefundFingerprint(rawInputId, amount) },
        );
        await ctx.reply(
          refundCard({
            amount,
            currency,
            merchant: target.merchant ?? "",
            day: target.spentAt,
            todayDay,
          }),
          { parse_mode: "HTML" },
        );
        continue;
      }
    }

    // Доход не участвует в категориях и в «Потрачено» — только в своей строке.
    if (entry.kind === "income") {
      const rate = await rateToUsd(currency, spentAt);
      const baseRate = await rateToUsd(base, spentAt);

      await createExpense({
        ledgerId,
        userId: user.id,
        categoryId: null,
        amount,
        currency,
        rateToUsd: rate,
        spentAt,
        merchant: entry.merchant,
        confidence: null,
        needsReview: false,
        kind: "income",
        incomeSource: entry.incomeSource,
        rawInputId,
      });

      await ctx.reply(
        incomeCard({
          source: entry.incomeSource ?? "Доход",
          amount,
          currency,
          baseAmount: (amount * rate) / baseRate,
          baseCurrency: base,
          day: spentAt,
          todayDay,
        }),
        { parse_mode: "HTML" },
      );
      continue;
    }

    const decision = await categorize(
      {
        raw: entry.raw,
        merchant: entry.merchant,
        amount,
        currency,
        categories: options,
        recentCorrections: corrections,
      },
      {
        rules,
        classify: (input) =>
          classify(input, { apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL }),
      },
    );

    const category = await categoryBySlug(ledgerId, decision.slug);
    const rate = await rateToUsd(currency, spentAt);

    const expense = await createExpense({
      ledgerId,
      userId: user.id,
      categoryId: category?.id ?? null,
      amount,
      currency,
      rateToUsd: rate,
      spentAt,
      merchant: decision.merchant,
      confidence: decision.confidence,
      needsReview: decision.needsReview,
      rawInputId,
    });

    const baseRate = await rateToUsd(base, spentAt);
    const dayTotalUsd = await totalSince(ledgerId, todayDay);
    const monthTotalUsd = await totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`);

    const card = expenseCard({
      emoji: category?.emoji ?? "📦",
      categoryTitle: category?.title ?? null,
      amount,
      currency,
      baseAmount: (amount * rate) / baseRate,
      baseCurrency: base,
      merchant: decision.merchant,
      day: spentAt,
      todayDay,
      dayTotal: dayTotalUsd / baseRate,
      monthTotal: monthTotalUsd / baseRate,
      lowConfidence: decision.ask,
      pending: decision.needsReview,
    });

    const sent = await ctx.reply(card, {
      parse_mode: "HTML",
      reply_markup: cardKeyboard(expense.id),
    });

    await db.insert(schema.botMessages).values({
      userId: user.id,
      chatId,
      messageId: sent.message_id,
      kind: "card",
      expenseId: expense.id,
    });
  }

  // Панель показывает итог дня, а он только что изменился.
  // Закреп всегда про открытую книгу: запись с префиксом «чай:» уходит в дело,
  // но панель не должна вдруг показать итог дела вместо своего.
  const shownId = await activeLedgerId(user).catch(() => ledgerId);
  await refreshPanel(ctx.api, user, shownId, chatId).catch(() => undefined);

  await notifyPartners(ctx, user, ledgerId, parsed.length).catch(() => undefined);
}

/**
 * Уведомление остальным участникам общей книги.
 *
 * Одно сообщение на всё внесённое разом: человек, записавший подряд три
 * покупки, не должен превращаться в три уведомления у партнёра.
 */
async function notifyPartners(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  count: number,
): Promise<void> {
  const members = await membersOf(ledgerId);
  if (members.length < 2) return;

  const name = user.firstName ?? user.username ?? "партнёр";
  const text =
    count === 1
      ? `${name} записал трату в общий бюджет`
      : `${name} записал ${plural(count, "трату", "траты", "трат")} в общий бюджет`;

  for (const member of members) {
    if (member.userId === user.id) continue;
    await ctx.api.sendMessage(member.tgId, text).catch(() => undefined);
  }
}

/**
 * Удаление сообщения пользователя.
 *
 * Telegram разрешает это только для сообщений моложе 48 часов, а в редких
 * случаях запрещает вовсе. Провал здесь не должен ронять обработку траты:
 * чистый чат приятен, но трата важнее.
 */
async function deleteUserMessage(ctx: Context): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Сообщение останется в чате — не повод терять трату.
  }
}

export function shiftDay(day: string, daysAgo: number): string {
  if (daysAgo === 0) return day;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

/**
 * Повторный разбор после правки сообщения.
 *
 * Старые операции этого сообщения удаляются мягко, карточки убираются, и всё
 * записывается заново. Проще и честнее, чем угадывать, какую именно строку
 * человек поправил в сообщении из трёх трат.
 *
 * Операции ищутся по ссылке на сообщение, а не по времени карточек: раньше
 * правка старого сообщения сносила всё, что внесено после него, доходы при
 * этом задваивались, а возврат гасил покупку второй раз.
 */
export async function handleEditedMessage(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  text: string,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const messageId = ctx.editedMessage?.message_id;
  if (messageId === undefined) return;

  const original = await db.query.rawInputs.findFirst({
    where: and(eq(schema.rawInputs.chatId, chatId), eq(schema.rawInputs.tgMessageId, messageId)),
  });

  // Сообщение, которого бот не видел, правкой не становится тратой.
  if (!original) return;

  const previous = await expensesOfMessage(original.id);
  const removed: number[] = [];
  for (const expense of previous) removed.push(...(await removeExpense(expense)));

  await revertMessageRefunds(original.id);

  if (removed.length > 0) {
    const cards = await db.query.botMessages.findMany({
      where: and(
        eq(schema.botMessages.kind, "card"),
        inArray(schema.botMessages.expenseId, removed),
        isNull(schema.botMessages.cleanedAt),
      ),
    });

    for (const card of cards) {
      await ctx.api.deleteMessage(card.chatId, card.messageId).catch(() => undefined);
      await db
        .update(schema.botMessages)
        .set({ cleanedAt: new Date() })
        .where(eq(schema.botMessages.id, card.id));
    }
  }

  await db
    .update(schema.rawInputs)
    .set({ text })
    .where(eq(schema.rawInputs.id, original.id));

  // Префикс книги в правленом тексте работает так же, как в новом сообщении.
  const routed = await routeByPrefix(user, text, ledgerId);
  await saveExpenses(ctx, user, routed.ledgerId, chatId, routed.text, original.id);
}
