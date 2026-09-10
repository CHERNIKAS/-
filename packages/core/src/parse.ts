import { ALL_ALIASES, CURRENCY_SYMBOLS, type Currency, matchCurrency } from "./currencies.js";

export type ParsedEntry = {
  /** Исходный фрагмент — сохраняется всегда, даже если разобрать не удалось. */
  raw: string;
  amount: number | null;
  currency: Currency | null;
  /** Сдвиг в днях назад от сегодняшнего дня: 0 — сегодня, 1 — вчера. */
  daysAgo: number;
  /** Что осталось от строки после вычитания суммы, валюты и даты. */
  merchant: string;
  /** Строка без суммы разбирать нечего — трату не создаём. */
  ok: boolean;
  /** Расход или доход. Доход отмечается плюсом или словом-источником. */
  kind: "expense" | "income";
  /** Откуда доход: «Поступления» по умолчанию, «Возврат» у возвратов. */
  incomeSource: string | null;
  /** Возврат — не доход: он гасит прошлую покупку. */
  isRefund: boolean;
  /**
   * Явно написанная дата: «5 сентября», «5/09», «05.09.2026».
   *
   * Год необязателен — его достраивают от сегодняшнего дня. Голое «5.09» без
   * года и без месяца словом не считается датой намеренно: «кофе 4.50» тогда
   * пришлось бы угадывать, сумма это или четвёртое мая.
   */
  dateHint: { day: number; month: number; year: number | null } | null;
};

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, мая: 5, май: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, сентяб: 9, октябр: 10, ноябр: 11, декабр: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, июнь: 6, июль: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

/** «5 сентября», «5 сен» */
const DATE_WORD_RE = /(?<![\d])(\d{1,2})\s+([а-яё]{3,})/iu;

/** «5/09», «05.09.2026», «5-9-26» — со слэшем или с годом, без догадок. */
const DATE_NUM_RE =
  /(?<![\d.,])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?![\d])/u;

/**
 * Слова, по которым строка читается как доход.
 *
 * Плюс впереди работает всегда, но писать «+» неудобно, а «зарплата 60000»
 * человек напишет сам и ждёт, что это не станет тратой.
 *
 * Все они дают один нейтральный источник: дробить приход на зарплату,
 * фриланс и подарки — это чужая раскладка, а свои названия заводятся в
 * настройках.
 */
const INCOME_WORDS: Record<string, string> = {
  зарплата: "Поступления",
  зп: "Поступления",
  аванс: "Поступления",
  оклад: "Поступления",
  премия: "Поступления",
  фриланс: "Поступления",
  гонорар: "Поступления",
  подработка: "Поступления",
  доход: "Поступления",
  приход: "Поступления",
  поступление: "Поступления",
  подарили: "Поступления",
  продал: "Поступления",
  продала: "Поступления",
  кэшбек: "Поступления",
  кешбек: "Поступления",
  кэшбэк: "Поступления",
};

/** Возврат разбирается отдельно: он не доход, а отмена покупки. */
const REFUND_WORDS = ["возврат", "вернули", "вернул", "вернула", "рефанд"];

function word(needle: string): RegExp {
  return new RegExp(`(?<![\\p{L}])${needle}(?![\\p{L}])`, "iu");
}

/**
 * Разделители между тратами в одном сообщении: перенос строки, точка с запятой,
 * запятая и точка.
 *
 * Точка и запятая считаются разделителем ТОЛЬКО когда не стоят между цифрами —
 * иначе "кофе 4.50" распалось бы на две траты. Поэтому `кофе 4.50. такси 12`
 * разбирается верно: первая точка десятичная, вторая — разделитель.
 */
export function splitEntries(input: string): string[] {
  const parts: string[] = [];
  let current = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;

    if (ch === "\n" || ch === ";") {
      parts.push(current);
      current = "";
      continue;
    }

    if (ch === "." || ch === ",") {
      const prev = input[i - 1];
      const next = input[i + 1];
      const betweenDigits = prev !== undefined && next !== undefined && isDigit(prev) && isDigit(next);
      if (!betweenDigits) {
        parts.push(current);
        current = "";
        continue;
      }
    }

    current += ch;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** 15 · 1000 · 1 000 · 4.50 · 4,50 · 1 000,50 */
const AMOUNT_RE = /(?<![\d.,])\d+(?:[  ]\d{3})*(?:[.,]\d{1,2})?(?![\d])/u;

const DATE_WORDS: Record<string, number> = {
  сегодня: 0,
  вчера: 1,
  позавчера: 2,
};

/**
 * Быстрый локальный разбор одного фрагмента.
 *
 * Сумма, валюта и дата достаются здесь и сейчас, без сети — ошибиться в них
 * практически негде. Категорию этот слой не трогает: ею занимаются правила
 * пользователя и модель.
 */
export function parseEntry(raw: string): ParsedEntry {
  const trimmed = raw.trim();
  let rest = trimmed;
  let daysAgo = 0;

  // Плюс впереди — самый короткий способ сказать «это пришло, а не ушло».
  let kind: "expense" | "income" = rest.startsWith("+") ? "income" : "expense";
  if (rest.startsWith("+")) rest = rest.slice(1);

  let isRefund = false;
  for (const needle of REFUND_WORDS) {
    const re = word(needle);
    if (!re.test(rest)) continue;

    isRefund = true;
    kind = "income";
    rest = rest.replace(re, " ");
    break;
  }

  let incomeSource: string | null = isRefund ? "Возврат" : null;

  if (!isRefund) {
    for (const [needle, title] of Object.entries(INCOME_WORDS)) {
      const re = word(needle);
      if (!re.test(rest)) continue;

      kind = "income";
      incomeSource = title;
      rest = rest.replace(re, " ");
      break;
    }
  }

  let dateHint: ParsedEntry["dateHint"] = null;

  const worded = DATE_WORD_RE.exec(rest);
  if (worded !== null) {
    const [, day, monthWord] = worded as unknown as [string, string, string];
    const clean = monthWord.toLowerCase();
    const entry = Object.entries(MONTHS).find(([stem]) => clean.startsWith(stem));

    if (entry !== undefined) {
      dateHint = { day: Number(day), month: entry[1], year: null };
      rest = rest.replace(worded[0], " ");
    }
  }

  if (dateHint === null) {
    const numeric = DATE_NUM_RE.exec(rest);
    // Точка без года — это чаще копейки, чем дата: такую пару пропускаем.
    const written = numeric === null ? "" : numeric[0];
    const hasYear = numeric !== null && numeric[3] !== undefined;

    if (numeric !== null && (written.includes("/") || written.includes("-") || hasYear)) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]);

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        dateHint = { day, month, year: hasYear ? Number(numeric[3]) : null };
        rest = rest.replace(written, " ");
      }
    }
  }

  for (const [needle, shift] of Object.entries(DATE_WORDS)) {
    const re = word(needle);
    if (re.test(rest)) {
      daysAgo = shift;
      rest = rest.replace(re, " ");
      break;
    }
  }

  let currency: Currency | null = null;

  for (const symbol of CURRENCY_SYMBOLS) {
    if (rest.includes(symbol)) {
      currency = matchCurrency(symbol);
      rest = rest.split(symbol).join(" ");
      break;
    }
  }

  if (currency === null) {
    for (const alias of ALL_ALIASES) {
      if (!/^[\p{L}]+$/u.test(alias)) continue;
      const re = word(alias);
      if (re.test(rest)) {
        currency = matchCurrency(alias);
        rest = rest.replace(re, " ");
        break;
      }
    }
  }

  const amountMatch = AMOUNT_RE.exec(rest);
  const amount = amountMatch ? normalizeAmount(amountMatch[0]) : null;
  if (amountMatch) {
    rest = rest.slice(0, amountMatch.index) + " " + rest.slice(amountMatch.index + amountMatch[0].length);
  }

  const merchant = rest.replace(/\s+/gu, " ").trim();

  return {
    raw: trimmed,
    amount,
    currency,
    daysAgo,
    merchant,
    ok: amount !== null && amount > 0,
    kind,
    dateHint,
    // Пустой источник выглядел бы как недоразобранная строка.
    incomeSource: kind === "income" && incomeSource === null ? "Поступления" : incomeSource,
    isRefund,
  };
}

function normalizeAmount(token: string): number {
  const cleaned = token.replace(/[  ]/gu, "").replace(",", ".");
  return Number.parseFloat(cleaned);
}

/** Разбор целого сообщения: несколько трат одной строкой или в столбик. */
export function parseMessage(input: string): ParsedEntry[] {
  return splitEntries(input).map(parseEntry);
}

/**
 * День траты по разобранной строке.
 *
 * Год у явной даты достраивается от сегодняшнего: написали «5 сентября» в
 * январе — значит, речь о прошлом сентябре, а не о будущем.
 */
export function resolveSpentAt(entry: ParsedEntry, today: string): string {
  if (entry.dateHint === null) return shift(today, entry.daysAgo);

  const { day, month } = entry.dateHint;
  const year = entry.dateHint.year ?? Number(today.slice(0, 4));
  const full = year < 100 ? 2000 + year : year;
  const iso = `${full}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (entry.dateHint.year !== null) return iso > today ? shift(today, 0) : iso;

  return iso > today
    ? `${full - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : iso;
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
