import { CURRENCY_SYMBOL, type Currency } from "@costnote/core";

/**
 * Оформление сообщений.
 *
 * Суммы моноширинные, чтобы цифры стояли столбиком. Один смайлик на блок, и
 * он несёт смысл — метка категории. Тонкий разделитель вместо рамок. Главное
 * первой строкой, детали ниже.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function money(amount: number, currency: Currency): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${CURRENCY_SYMBOL[currency]}${formatted}`;
}

/**
 * Компактная сумма для итогов: копейки там только мешают.
 *
 * Кроме мелких сумм — «₺15 ≈ $0» выглядит как ошибка, хотя это честные
 * тридцать центов. Ниже десяти показываем два знака.
 */
export function moneyShort(amount: number, currency: Currency): string {
  const digits = Math.abs(amount) < 10 && amount !== 0 ? 2 : 0;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  return `${CURRENCY_SYMBOL[currency]}${formatted}`;
}

const BREAK = String.fromCharCode(10);

const MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

export function humanDay(day: string, todayDay: string): string {
  if (day === todayDay) return "сегодня";

  const date = new Date(`${day}T00:00:00Z`);
  const today = new Date(`${todayDay}T00:00:00Z`);
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);

  if (diff === 1) return "вчера";
  if (diff === 2) return "позавчера";

  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export type CardData = {
  emoji: string;
  categoryTitle: string | null;
  amount: number;
  currency: Currency;
  /** Пересчёт в основную валюту — показывается, только если валюты разные. */
  baseAmount: number;
  baseCurrency: Currency;
  merchant: string;
  day: string;
  todayDay: string;
  dayTotal: number;
  monthTotal: number;
  lowConfidence: boolean;
  pending: boolean;
};

export function expenseCard(d: CardData): string {
  const head = d.pending
    ? "⏳ определяю категорию"
    : d.lowConfidence
      ? `${d.emoji} ${d.categoryTitle ?? "Прочее"} — уверен не до конца`
      : `${d.emoji} ${d.categoryTitle ?? "Прочее"}`;

  const lines = [`<i>${escapeHtml(head)}</i>`, `<code>${money(d.amount, d.currency)}</code>`];

  const meta = [];
  if (d.currency !== d.baseCurrency) meta.push(`≈ ${money(d.baseAmount, d.baseCurrency)}`);
  meta.push(humanDay(d.day, d.todayDay));
  lines.push(`<i>${escapeHtml(meta.join(" · "))}</i>`);

  lines.push("——————");

  if (d.merchant !== "") lines.push(escapeHtml(d.merchant));
  lines.push(
    `<i>день</i> <code>${moneyShort(d.dayTotal, d.baseCurrency)}</code>` +
      `  <i>месяц</i> <code>${moneyShort(d.monthTotal, d.baseCurrency)}</code>`,
  );

  return lines.join("\n");
}

/**
 * Карточка дохода.
 *
 * Без категорий и без итогов дня: доход не тратится и в «Потрачено» не
 * входит, а показывать рядом с ним расходную сводку — смешивать одно с другим.
 */
export function incomeCard(d: {
  source: string;
  amount: number;
  currency: Currency;
  baseAmount: number;
  baseCurrency: Currency;
  day: string;
  todayDay: string;
}): string {
  const meta = [];
  if (d.currency !== d.baseCurrency) meta.push(`≈ ${money(d.baseAmount, d.baseCurrency)}`);
  meta.push(humanDay(d.day, d.todayDay));

  return [
    `<i>${escapeHtml(`Доход · ${d.source}`)}</i>`,
    `<code>+${money(d.amount, d.currency)}</code>`,
    `<i>${escapeHtml(meta.join(" · "))}</i>`,
  ].join(BREAK);
}

/** Возврат гасит покупку, поэтому карточка говорит, какую именно. */
export function refundCard(d: {
  amount: number;
  currency: Currency;
  merchant: string;
  day: string;
  todayDay: string;
}): string {
  return [
    "<i>Возврат</i>",
    `<code>+${money(d.amount, d.currency)}</code>`,
    `<i>${escapeHtml(`погасил покупку${d.merchant === "" ? "" : ` «${d.merchant}»`} · ${humanDay(d.day, d.todayDay)}`)}</i>`,
  ].join(BREAK);
}

export function deleteConfirmation(d: {
  amount: number;
  currency: Currency;
  merchant: string;
}): string {
  return [
    "<b>Удалить трату?</b>",
    `<code>${money(d.amount, d.currency)}</code>${d.merchant === "" ? "" : ` · ${escapeHtml(d.merchant)}`}`,
  ].join("\n");
}
