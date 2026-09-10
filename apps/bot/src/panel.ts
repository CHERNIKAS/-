import type { Currency } from "@costnote/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Api } from "grammy";
import { db, schema } from "@costnote/core/data";
import { escapeHtml, moneyShort } from "./format.js";
import { totalSince } from "@costnote/core/data";
import { ledgersOf, rateToUsd, today } from "@costnote/core/data";
import type { AppUser } from "@costnote/core/data";

/**
 * Закреплённая панель с итогом дня и месяца.
 *
 * Одно сообщение на всю жизнь чата: после каждой траты оно правится, а не
 * отправляется заново. Раз в сутки пересоздаётся — Telegram разрешает боту
 * редактировать своё сообщение только 48 часов, и на вторые сутки правка
 * молча перестала бы работать.
 */

async function panelText(user: AppUser, ledgerId: number): Promise<string> {
  const todayDay = today();
  const base = user.currency as Currency;
  const rate = await rateToUsd(base, todayDay);

  const dayUsd = await totalSince(ledgerId, todayDay);
  const monthUsd = await totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`);

  const lines = [
    `<b>Сегодня</b>  <code>${moneyShort(dayUsd / rate, base)}</code>`,
    `<i>месяц</i>  <code>${moneyShort(monthUsd / rate, base)}</code>`,
  ];

  // Какая книга открыта — самое важное в панели: без этого закупка для дела
  // тихо ляжет в личные траты, и заметишь ты это через месяц.
  const books = await ledgersOf(user.id);
  const book = books.find((b) => b.id === ledgerId);
  if (book !== undefined && book.kind !== "personal") {
    lines.push(`<i>книга</i>  <b>${escapeHtml(book.title)}</b>`);
  }

  if (user.monthlyBudget !== null) {
    const budget = Number(user.monthlyBudget);
    const left = budget - monthUsd / rate;
    lines.push(
      left >= 0
        ? `<i>осталось</i>  <code>${moneyShort(left, base)}</code> <i>из ${moneyShort(budget, base)}</i>`
        : `<i>перерасход</i>  <code>${moneyShort(-left, base)}</code>`,
    );
  }

  return lines.join("\n");
}

async function currentPanel(userId: number) {
  return db.query.botMessages.findFirst({
    where: and(
      eq(schema.botMessages.userId, userId),
      eq(schema.botMessages.kind, "panel"),
      isNull(schema.botMessages.cleanedAt),
    ),
    orderBy: desc(schema.botMessages.createdAt),
  });
}

/** Возраст сообщения, после которого Telegram уже не даст его отредактировать. */
const EDIT_WINDOW_MS = 40 * 60 * 60 * 1000;

export async function refreshPanel(
  api: Api,
  user: AppUser,
  ledgerId: number,
  chatId: string,
): Promise<void> {
  const text = await panelText(user, ledgerId);
  const existing = await currentPanel(user.id);

  if (existing) {
    const age = Date.now() - existing.createdAt.getTime();
    if (age < EDIT_WINDOW_MS) {
      try {
        await api.editMessageText(chatId, existing.messageId, text, { parse_mode: "HTML" });
        return;
      } catch {
        // Сообщение могли удалить руками — тогда просто создадим новое ниже.
      }
    }

    await retirePanel(api, chatId, existing.id, existing.messageId);
  }

  await createPanel(api, user.id, ledgerId, chatId, text);
}

async function retirePanel(
  api: Api,
  chatId: string,
  rowId: number,
  messageId: number,
): Promise<void> {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // Старше 48 часов удалить уже нельзя — останется в чате, ничего страшного.
  }
  await db
    .update(schema.botMessages)
    .set({ cleanedAt: new Date() })
    .where(eq(schema.botMessages.id, rowId));
}

async function createPanel(
  api: Api,
  userId: number,
  _ledgerId: number,
  chatId: string,
  text: string,
): Promise<void> {
  const sent = await api.sendMessage(chatId, text, { parse_mode: "HTML" });

  try {
    await api.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
  } catch {
    // Закрепление могут не разрешить — панель просто останется обычным сообщением.
  }

  await db.insert(schema.botMessages).values({
    userId,
    chatId,
    messageId: sent.message_id,
    kind: "panel",
  });
}
