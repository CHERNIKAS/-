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
  /** Откуда доход, если его удалось назвать: зарплата, фриланс, подарок. */
  incomeSource: string | null;
  /** Возврат — не доход: он гасит прошлую покупку. */
  isRefund: boolean;
};

/**
 * Слова, по которым строка читается как доход.
 *
 * Плюс впереди работает всегда, но писать «+» неудобно, а «зарплата 60000»
 * человек напишет сам и ждёт, что это не станет тратой.
 */
const INCOME_WORDS: Record<string, string> = {
  зарплата: "Зарплата",
  зп: "Зарплата",
  аванс: "Зарплата",
  оклад: "Зарплата",
  фриланс: "Фриланс",
  гонорар: "Фриланс",
  подработка: "Фриланс",
  доход: "Доход",
  приход: "Доход",
  премия: "Премия",
  подарили: "Подарок",
  подарок: "Подарок",
  продал: "Продажа",
  продала: "Продажа",
  кэшбек: "Кэшбек",
  кешбек: "Кэшбек",
  кэшбэк: "Кэшбек",
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
    // Доход без названного источника — просто «Доход»: пусто выглядело бы
    // как недоразобранная строка.
    incomeSource: kind === "income" && incomeSource === null ? "Доход" : incomeSource,
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
