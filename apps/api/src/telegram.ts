import type { Currency } from "@costnote/core";
import { db, schema } from "@costnote/core/data";
import { and, eq, isNull } from "drizzle-orm";

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
