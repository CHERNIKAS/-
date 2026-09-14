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

/**
 * Месяц словом: основа и короткое окончание, не длиннее «-ября».
 *
 * Без этого ограничения «такси 12 декабристов» читалось как 12 декабря.
 */
function monthOf(word: string): number | null {
  const clean = word.toLowerCase();
  const entry = Object.entries(MONTHS).find(
    ([stem]) => clean.startsWith(stem) && clean.length - stem.length <= 3,
  );
  return entry === undefined ? null : entry[1];
}

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

/**
 * 15 · 1000 · 1 000 · 1,000 · 1.000 · 4.50 · 4,50 · 1 000,50
 *
 * Разделитель тысяч — пробел, точка или запятая перед ровно тремя цифрами.
 * «1,000 лир» раньше читалось как одна лира.
 */
const AMOUNT_RE =
  /(?<![\d.,])(?:\d{1,3}(?:[  ]\d{3})+|\d{1,3}(?:,\d{3})+(?![\d.])|\d{1,3}(?:\.\d{3})+(?![\d,])|\d+)(?:[.,]\d{1,2})?(?![\d])/gu;

/** Место, где стояла валюта: сумма рядом с ней и есть сумма траты. */
const CURRENCY_MARK = "";

const DATE_WORDS: Record<string, number> = {
  сегодня: 0,
  вчера: 1,
  позавчера: 2,
};

/** Сколько дней в месяце; без года февраль считается високосным. */
export function daysInMonth(month: number, year: number | null): number {
  if (month === 2) {
    if (year === null) return 29;
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Настоящая ли это дата: «2026-02-31» база не примет и уронит сохранение. */
export function isRealDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year);
}

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
    const month = monthOf(monthWord);

    if (month !== null && Number(day) >= 1 && Number(day) <= daysInMonth(month, null)) {
      dateHint = { day: Number(day), month, year: null };
      rest = rest.replace(worded[0], " ");
    }
  }

  if (dateHint === null) {
    const numeric = DATE_NUM_RE.exec(rest);
    const written = numeric === null ? "" : numeric[0];
    const hasYear = numeric !== null && numeric[3] !== undefined;

    // Точка без года — это чаще копейки, чем дата; дефис без года — чаще
    // диапазон «12-15», чем число. Датой без года считается только слэш.
    if (numeric !== null && (written.includes("/") || hasYear)) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]);
      const year = hasYear ? Number(numeric[3]) : null;
      const fullYear = year === null ? null : year < 100 ? 2000 + year : year;

      if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, fullYear)) {
        dateHint = { day, month, year };
      }
      // Даже несуществующая «31/02» — это дата, а не сумма: её цифры не должны
      // стать суммой траты.
      rest = rest.replace(written, " ");
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
      rest = rest.split(symbol).join(` ${CURRENCY_MARK} `);
      break;
    }
  }

  if (currency === null) {
    for (const alias of ALL_ALIASES) {
      if (!/^[\p{L}]+$/u.test(alias)) continue;
      const re = word(alias);
      if (re.test(rest)) {
        currency = matchCurrency(alias);
        rest = rest.replace(re, ` ${CURRENCY_MARK} `);
        break;
      }
    }
  }

  const match = pickAmount(rest);
  const amount = match === null ? null : normalizeAmount(match.text);
  if (match !== null) {
    rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match.text.length)}`;
  }

  const merchant = rest
    .split(CURRENCY_MARK)
    .join(" ")
    .replace(/\s+/gu, " ")
    // Хвосты от вырезанного: «кафе -15» оставляло «кафе -».
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/gu, "")
    .trim();

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

/**
 * Какое из чисел в строке — сумма.
 *
 * Раньше бралось первое, и «айфон 15 1000$» стоил 15 долларов. Теперь
 * главнее число рядом с валютой; если валюты нет — последнее: сумму пишут в
 * конце, а числа в названии идут раньше — «бургер 2 шт 300», «такси 12
 * декабристов 5».
 */
function pickAmount(text: string): { text: string; index: number } | null {
  const found = [...text.matchAll(AMOUNT_RE)].map((m) => ({ text: m[0], index: m.index ?? 0 }));
  if (found.length === 0) return null;
  if (found.length === 1) return found[0] ?? null;

  const near = found.filter((m) => {
    const before = text.slice(0, m.index).trimEnd();
    const after = text.slice(m.index + m.text.length).trimStart();
    return before.endsWith(CURRENCY_MARK) || after.startsWith(CURRENCY_MARK);
  });

  const pool = near.length > 0 ? near : found;
  return pool[pool.length - 1] ?? null;
}

function normalizeAmount(token: string): number {
  const compact = token.replace(/[  ]/gu, "");
  // Последний разделитель с одной-двумя цифрами после — десятичный, остальные — тысячи.
  const decimal = /[.,](\d{1,2})$/.exec(compact);
  const whole = decimal === null ? compact : compact.slice(0, decimal.index);
  const digits = whole.replace(/[.,]/g, "");
  return Number.parseFloat(decimal === null ? digits : `${digits}.${decimal[1]}`);
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
  const iso = isoDay(full, month, day);

  if (entry.dateHint.year !== null) return iso > today ? shift(today, 0) : iso;

  return iso > today ? isoDay(full - 1, month, day) : iso;
}

/**
 * Дата без выхода за конец месяца: «29 февраля» в невисокосный год
 * становится 28-м, а не несуществующим днём, который уронит сохранение.
 */
function isoDay(year: number, month: number, day: number): string {
  const safe = Math.min(day, daysInMonth(month, year));
  return `${year}-${String(month).padStart(2, "0")}-${String(safe).padStart(2, "0")}`;
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
