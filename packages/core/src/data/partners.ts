import { eq } from "drizzle-orm";
import { CURRENCY_SYMBOL, type Currency } from "../currencies.js";
import { db, schema } from "./db.js";
import { membersOf } from "./ledgers.js";
import type { AppUser } from "./users.js";

/**
 * Уведомление партнёрам по общей книге.
 *
 * Раньше приходило «записал трату в общий бюджет» — без суммы и без названия,
 * и понять, что произошло, можно было только открыв приложение. Теперь в
 * уведомлении сами операции: сумма, валюта, что это.
 */

export type NoticeItem = {
  kind: "expense" | "income" | "refund";
  amount: number;
  currency: Currency;
  title: string;
};

const NL = String.fromCharCode(10);
const MAX_LINES = 15;

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

function line(item: NoticeItem): string {
  const title = item.title.trim() === "" ? "" : ` · ${escape(item.title.trim())}`;
  if (item.kind === "income") return `<code>+${money(item.amount, item.currency)}</code>${title}`;
  if (item.kind === "refund") return `<code>↩ ${money(item.amount, item.currency)}</code>${title} <i>возврат</i>`;
  return `<code>−${money(item.amount, item.currency)}</code>${title}`;
}

/**
 * Текст и получатели уведомления. null — если книга не общая или сообщать нечего.
 */
export async function partnerNotice(
  user: AppUser,
  ledgerId: number,
  items: NoticeItem[],
): Promise<{ recipients: string[]; text: string } | null> {
  if (items.length === 0) return null;

  const members = await membersOf(ledgerId);
  const recipients = members.filter((m) => m.userId !== user.id).map((m) => m.tgId);
  if (recipients.length === 0) return null;

  const ledger = await db.query.ledgers.findFirst({ where: eq(schema.ledgers.id, ledgerId) });
  const name = user.firstName ?? user.username ?? "Партнёр";
  const book = ledger === undefined || ledger.kind === "personal" ? "Личное" : ledger.title;

  const lines = [`<b>${escape(name)}</b> · <i>${escape(book)}</i>`, ...items.slice(0, MAX_LINES).map(line)];
  if (items.length > MAX_LINES) lines.push(`<i>…и ещё ${items.length - MAX_LINES}</i>`);

  return { recipients, text: lines.join(NL) };
}
