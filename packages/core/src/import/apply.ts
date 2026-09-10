import { createHash } from "node:crypto";
import { CURRENCIES, type Currency, matchCurrency } from "../currencies.js";
import type { Mapping } from "./detect.js";
import type { Sheet } from "./read.js";

/**
 * Применение карты формата к строкам файла.
 *
 * Числа и даты берутся из файла как есть — модель к ним не прикасалась и не
 * прикоснётся. Её работа закончилась на том, чтобы указать, где что лежит.
 */

export type ImportedRow = {
  spentAt: string;
  amount: number;
  currency: Currency | null;
  description: string;
  fingerprint: string;
};

export type ParseResult = {
  rows: ImportedRow[];
  /** Строки, которые не разобрались: видно, сколько потеряно и почему. */
  skipped: number;
  /** Приходы и переводы: в расходы они не идут. */
  incomes: number;
  /** Отменённые и незавершённые операции — денег не двигали. */
  cancelled: number;
};

export function applyMapping(sheet: Sheet, mapping: Mapping, today: string): ParseResult {
  const rows: ImportedRow[] = [];
  let skipped = 0;
  let incomes = 0;
  let cancelled = 0;

  for (const raw of sheet.slice(Math.max(0, mapping.skipRows))) {
    const dateCell = raw[mapping.dateColumn] ?? "";
    const amountCell = raw[mapping.amountColumn] ?? "";
    const description = (raw[mapping.descriptionColumn] ?? "").replace(/\s+/g, " ").trim();

    // Отменённая операция денег не двигала: в выписках их бывают десятки, и
    // посчитать их тратами — самый простой способ раздуть месяц вдвое.
    if (mapping.statusColumn !== null && mapping.okStatuses.length > 0) {
      const status = (raw[mapping.statusColumn] ?? "").trim().toLowerCase();
      if (status !== "" && !mapping.okStatuses.some((ok) => ok.toLowerCase() === status)) {
        cancelled++;
        continue;
      }
    }

    const spentAt = parseDate(dateCell, mapping.dateOrder, today);
    const value = parseAmount(amountCell, mapping.decimalSeparator);

    if (spentAt === null || value === null || value === 0) {
      skipped++;
      continue;
    }

    // Приход в отдельной колонке либо противоположный знак — это не трата.
    const credit =
      mapping.creditColumn === null
        ? null
        : parseAmount(raw[mapping.creditColumn] ?? "", mapping.decimalSeparator);

    if (credit !== null && credit !== 0) {
      incomes++;
      continue;
    }

    const isExpense = mapping.expenseIsNegative ? value < 0 : value > 0;
    if (!isExpense) {
      incomes++;
      continue;
    }

    const amount = Math.abs(value);
    const currency =
      mapping.currencyColumn === null
        ? mapping.currency
        : (matchCurrency(raw[mapping.currencyColumn] ?? "") ?? mapping.currency);

    rows.push({
      spentAt,
      amount,
      currency: currency !== null && CURRENCIES.includes(currency) ? currency : null,
      description,
      fingerprint: fingerprint(spentAt, amount, description),
    });
  }

  return { rows, skipped, incomes, cancelled };
}

/** Отпечаток строки: одинаковые операции из одного файла не задваиваются. */
export function fingerprint(spentAt: string, amount: number, description: string): string {
  const key = `${spentAt}|${amount.toFixed(2)}|${description.toLowerCase()}`;
  return createHash("sha1").update(key).digest("hex");
}

export function parseAmount(cell: string, decimal: "," | "."): number | null {
  const text = cell.replace(/\s| /g, "").trim();
  if (text === "") return null;

  // Банки помечают расход и скобками, и суффиксом DR — оба означают минус.
  const negative = /^\(.*\)$/.test(text) || /dr$/i.test(text) || text.startsWith("-");

  const digits =
    decimal === ","
      ? text.replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", ".")
      : text.replace(/[^\d.-]/g, "").replace(/,/g, "");

  const value = Number.parseFloat(digits.replace(/-/g, ""));
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

export function parseDate(cell: string, order: Mapping["dateOrder"], today: string): string | null {
  const text = cell.trim();
  const match = /(\d{1,4})[.\-/](\d{1,2})[.\-/](\d{2,4})/.exec(text);
  if (match === null) return null;

  const [, a, b, c] = match as unknown as [string, string, string, string];
  let day: number;
  let month: number;
  let year: number;

  if (order === "ymd") {
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else if (order === "mdy") {
    month = Number(a);
    day = Number(b);
    year = Number(c);
  } else {
    day = Number(a);
    month = Number(b);
    year = Number(c);
  }

  // Двузначный год: выписки за прошлый век нам не приносят.
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Дата из будущего означает, что порядок частей определён неверно.
  return iso > today ? null : iso;
}
