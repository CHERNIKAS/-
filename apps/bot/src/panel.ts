import type { Currency } from "@costnote/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Api } from "grammy";
import { db, schema } from "@costnote/core/data";
import { escapeHtml, moneyShort } from "./format.js";
import { totalSince } from "@costnote/core/data";
import { localToday, panelTotals, rateToUsd } from "@costnote/core/data";
import type { AppUser } from "@costnote/core/data";

/**
 * Закреплённая панель с итогом дня и месяца.
 *
 * Одно сообщение на всю жизнь чата: после каждой траты оно правится, а не
 * отправляется заново. Раз в сутки пересоздаётся — Telegram разрешает боту
 * редактировать своё сообщение только 48 часов, и на вторые сутки правка
 * молча перестала бы работать.
 */

/**
 * Текст закрепа: все книги сразу, пустые не показываются.
 *
 * Закреп — взгляд на все деньги, а не на открытую книгу: трата в «чайной» не
 * должна пропадать с глаз, пока открыт общий бюджет. Книга без трат за месяц
 * строку не занимает — иначе закреп из трёх пустых книг превращается в шум.
 */
async function panelText(user: AppUser, ledgerId: number): Promise<string> {
  const todayDay = localToday(user.timezone);
  const base = user.currency as Currency;
  const rate = await rateToUsd(base, todayDay);

  const books = (await panelTotals(user.id, todayDay)).filter((b) => b.monthUsd > 0);

  // Одна книга с тратами — прежний короткий вид, без подписи.
  if (books.length <= 1) {
    const only = books[0];
    const lines = [
      `<b>Сегодня</b>  <code>${moneyShort((only?.dayUsd ?? 0) / rate, base)}</code>`,
      `<i>месяц</i>  <code>${moneyShort((only?.monthUsd ?? 0) / rate, base)}</code>`,
    ];
    if (only !== undefined && only.kind !== "personal") {
      lines.push(`<i>книга</i>  <b>${escapeHtml(only.title)}</b>`);
    }
    return withBudget(lines, user, only?.monthUsd ?? 0, rate, base);
  }

  // Несколько книг — строка на каждую, открытая первой и отмеченной.
  const ordered = [...books].sort((a, b) => (a.id === ledgerId ? -1 : b.id === ledgerId ? 1 : 0));
  const lines = ordered.map(
    (b) =>
      `${b.id === ledgerId ? "<b>" : "<i>"}${escapeHtml(b.title)}${b.id === ledgerId ? "</b>" : "</i>"}  ` +
      `<code>${moneyShort(b.dayUsd / rate, base)}</code> <i>сегодня</i> · ` +
      `<code>${moneyShort(b.monthUsd / rate, base)}</code> <i>месяц</i>`,
  );

  const active = books.find((b) => b.id === ledgerId);
  return withBudget(lines, user, active?.monthUsd ?? 0, rate, base);
}

/** Бюджет — про открытую книгу: лимит ставится на жизнь, а не на дело. */
function withBudget(
  lines: string[],
  user: AppUser,
  monthUsd: number,
  rate: number,
  base: Currency,
): string {
  if (user.monthlyBudget !== null) {
    const budget = Number(user.monthlyBudget);
    const left = budget - monthUsd / rate;
    lines.push(
      left >= 0
        ? `<i>осталось</i>  <code>${moneyShort(left, base)}</code> <i>из ${moneyShort(budget, base)}</i>`
        : `<i>перерасход</i>  <code>${moneyShort(-left, base)}</code>`,
    );
  }

  return lines.join(String.fromCharCode(10));
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
