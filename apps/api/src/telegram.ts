import type { Currency } from "@costnote/core";
import { db, schema, rateToUsd, today, totalSince } from "@costnote/core/data";
import { and, desc, eq, isNull } from "drizzle-orm";

/**
 * Отражение действий приложения в чате.
 *
 * Бот и приложение — две поверхности над одними данными, и человек ждёт, что
 * они показывают одно и то же. Трата, добавленная в приложении, должна
 * появиться карточкой в чате; изменённая — обновиться; удалённая — исчезнуть.
 *
 * Сообщения шлются напрямую через API Telegram: поднимать ради этого связь
 * между процессами не из-за чего, запросов тут единицы в день.
 */

const NL = String.fromCharCode(10);
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", UAH: "₴", TRY: "₺" };

function money(amount: number, currency: string): string {
  const digits = Math.abs(amount) < 10 && amount !== 0 ? 2 : 0;
  return `${SYMBOL[currency] ?? ""}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)}`;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type CardData = {
  emoji: string;
  categoryTitle: string | null;
  amount: number;
  currency: Currency;
  baseAmount: number;
  baseCurrency: Currency;
  merchant: string;
  dayLabel: string;
  dayTotal: number;
  monthTotal: number;
};

export function cardText(d: CardData): string {
  const lines = [
    `<i>${escape(`${d.emoji} ${d.categoryTitle ?? "Прочее"}`)}</i>`,
    `<code>${money(d.amount, d.currency)}</code>`,
  ];

  const meta = [];
  if (d.currency !== d.baseCurrency) meta.push(`≈ ${money(d.baseAmount, d.baseCurrency)}`);
  meta.push(d.dayLabel);
  lines.push(`<i>${escape(meta.join(" · "))}</i>`, "——————");

  if (d.merchant !== "") lines.push(escape(d.merchant));
  lines.push(
    `<i>день</i> <code>${money(d.dayTotal, d.baseCurrency)}</code>` +
      `  <i>месяц</i> <code>${money(d.monthTotal, d.baseCurrency)}</code>`,
  );

  return lines.join(NL);
}

async function call(token: string, method: string, body: unknown): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return response.json();
}

/**
 * Карточка дохода.
 *
 * Без категорий и без итогов дня: доход не тратится и в «Потрачено» не входит,
 * а расходная сводка рядом с ним путала бы одно с другим.
 */
export function incomeText(d: {
  source: string;
  amount: number;
  currency: Currency;
  baseAmount: number;
  baseCurrency: Currency;
  dayLabel: string;
}): string {
  const meta = [];
  if (d.currency !== d.baseCurrency) meta.push(`≈ ${money(d.baseAmount, d.baseCurrency)}`);
  meta.push(d.dayLabel);

  return [
    `<i>${escape(`Доход · ${d.source}`)}</i>`,
    `<code>+${money(d.amount, d.currency)}</code>`,
    `<i>${escape(meta.join(" · "))}</i>`,
  ].join(NL);
}

/** Возврат гасит покупку — карточка говорит, какую именно. */
export function refundText(d: {
  amount: number;
  currency: Currency;
  merchant: string;
  dayLabel: string;
}): string {
  return [
    "<i>Возврат</i>",
    `<code>+${money(d.amount, d.currency)}</code>`,
    `<i>${escape(`погасил покупку${d.merchant === "" ? "" : ` «${d.merchant}»`} · ${d.dayLabel}`)}</i>`,
  ].join(NL);
}

/**
 * Сообщение без кнопок: доход и возврат нечего редактировать карточкой траты,
 * а «отменить» у возврата означало бы вернуть покупку — это отдельный разговор.
 */
export async function sendPlain(token: string, chatId: string, text: string): Promise<void> {
  await call(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

/**
 * Обновление закреплённой панели.
 *
 * Панель показывает итог дня и месяца, и её правит бот после каждой траты из
 * чата. Но траты меняются и в приложении: поправил дату — «сегодня» стало
 * другим, а закреп продолжал показывать вчерашнее число, будто ничего не
 * произошло. Одни и те же данные не должны расходиться между поверхностями.
 */
export async function refreshPanel(
  token: string,
  user: { id: number; currency: string; monthlyBudget: string | null },
  ledgerId: number,
): Promise<void> {
  const panel = await db.query.botMessages.findFirst({
    where: and(
      eq(schema.botMessages.userId, user.id),
      eq(schema.botMessages.kind, "panel"),
      isNull(schema.botMessages.cleanedAt),
    ),
    orderBy: desc(schema.botMessages.createdAt),
  });

  if (panel === undefined) return;

  const todayDay = today();
  const base = user.currency as Currency;
  const rate = await rateToUsd(base, todayDay);

  const dayUsd = await totalSince(ledgerId, todayDay);
  const monthUsd = await totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`);

  const lines = [
    `<b>Сегодня</b>  <code>${money(dayUsd / rate, base)}</code>`,
    `<i>месяц</i>  <code>${money(monthUsd / rate, base)}</code>`,
  ];

  if (user.monthlyBudget !== null) {
    const budget = Number(user.monthlyBudget);
    const left = budget - monthUsd / rate;
    lines.push(
      left >= 0
        ? `<i>осталось</i>  <code>${money(left, base)}</code>`
        : `<i>перерасход</i>  <code>${money(-left, base)}</code>`,
    );
  }

  await call(token, "editMessageText", {
    chat_id: panel.chatId,
    message_id: panel.messageId,
    text: lines.join(NL),
    parse_mode: "HTML",
  }).catch(() => undefined);
}

/** Карточка новой траты — с теми же кнопками, что у трат из чата. */
export async function sendCard(
  token: string,
  chatId: string,
  userId: number,
  expenseId: number,
  text: string,
): Promise<void> {
  const result = (await call(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Редактировать", callback_data: `x:edit:${expenseId}` },
          { text: "Отменить", callback_data: `x:del:${expenseId}` },
        ],
      ],
    },
  })) as { ok?: boolean; result?: { message_id?: number } };

  const messageId = result.result?.message_id;
  if (result.ok !== true || messageId === undefined) return;

  await db.insert(schema.botMessages).values({
    userId,
    chatId,
    messageId,
    kind: "card",
    expenseId,
  });
}

/** Правка в приложении переписывает уже отправленную карточку, а не шлёт новую. */
export async function updateCard(token: string, expenseId: number, text: string): Promise<void> {
  const cards = await db.query.botMessages.findMany({
    where: and(eq(schema.botMessages.expenseId, expenseId), isNull(schema.botMessages.cleanedAt)),
  });

  for (const card of cards) {
    await call(token, "editMessageText", {
      chat_id: card.chatId,
      message_id: card.messageId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Редактировать", callback_data: `x:edit:${expenseId}` },
            { text: "Отменить", callback_data: `x:del:${expenseId}` },
          ],
        ],
      },
    });
  }
}

/** Удалённая трата уносит и свою карточку: сообщение о несуществующем — мусор. */
export async function removeCards(token: string, expenseId: number): Promise<void> {
  const cards = await db.query.botMessages.findMany({
    where: and(eq(schema.botMessages.expenseId, expenseId), isNull(schema.botMessages.cleanedAt)),
  });

  for (const card of cards) {
    await call(token, "deleteMessage", { chat_id: card.chatId, message_id: card.messageId });
    await db
      .update(schema.botMessages)
      .set({ cleanedAt: new Date() })
      .where(eq(schema.botMessages.id, card.id));
  }
}
