import { createHash } from "node:crypto";
import { CURRENCIES, type Currency, matchCurrency } from "../currencies.js";
import type { Mapping } from "./detect.js";
import type { Sheet } from "./read.js";
import { classifyOperation, isSwap, type OperationKind } from "./kinds.js";
import { looksAccepted, looksIncoming, looksRejected } from "./statuses.js";

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
  /** Трата, доход или перекладывание своих денег. */
  kind: OperationKind;
  /** Деньги пришли, а не ушли: по этому признаку сводятся пары переносов. */
  incoming: boolean;
  /** Вторая сторона: адрес кошелька, отправитель, номер счёта. */
  counterparty: string;
};

export type ParseResult = {
  /** Все состоявшиеся операции файла — с уже определённым видом. */
  rows: ImportedRow[];
  /** Строки, которые не разобрались: видно, сколько потеряно и почему. */
  skipped: number;
  /** Приходы и переводы: в расходы они не идут. */
  incomes: number;
  /**
   * Сами приходы — по ним ищутся возвраты.
   *
   * Возврат приходит в выписке обычным плюсом, и отличить его от зарплаты
   * можно только по тому, что он гасит прошлую покупку на ту же сумму.
   */
  credits: ImportedRow[];
  /** Отменённые и незавершённые операции — денег не двигали. */
  cancelled: number;
  /** Обмены валют внутри счёта: денег не стало ни больше, ни меньше. */
  swaps: number;
};

export function applyMapping(sheet: Sheet, mapping: Mapping, today: string): ParseResult {
  const rows: ImportedRow[] = [];
  let skipped = 0;
  let incomes = 0;
  let cancelled = 0;
  let swaps = 0;
  const credits: ImportedRow[] = [];

  for (const raw of sheet.slice(Math.max(0, mapping.skipRows))) {
    const dateCell = raw[mapping.dateColumn] ?? "";
    const amountCell = raw[mapping.amountColumn] ?? "";
    const description = (raw[mapping.descriptionColumn] ?? "").replace(/\s+/g, " ").trim();
    const status = mapping.statusColumn === null ? "" : (raw[mapping.statusColumn] ?? "").trim();
    const type = mapping.typeColumn === null ? "" : (raw[mapping.typeColumn] ?? "").trim();
    const counterparty =
      mapping.counterpartyColumn === null ? "" : (raw[mapping.counterpartyColumn] ?? "").trim();

    // Обмен валют внутри счёта не движение денег: их сотни, и в отчётах им
    // делать нечего.
    if (isSwap(type)) {
      swaps++;
      continue;
    }

    // Отменённая операция денег не двигала: в выписках их бывают десятки, и
    // посчитать их тратами — самый простой способ раздуть месяц вдвое.
    const incomingByStatus = status !== "" && looksIncoming(status);
    if (!incomingByStatus && status !== "" && !accepted(status, mapping.okStatuses)) {
      cancelled++;
      continue;
    }

    const spentAt = parseDate(dateCell, mapping.dateOrder, today);
    const value = parseAmount(amountCell, mapping.decimalSeparator);

    if (spentAt === null || value === null || value === 0) {
      skipped++;
      continue;
    }

    // Приход виден с трёх сторон: по отдельной колонке, по знаку суммы и по
    // виду операции. Достаточно любой.
    const credit =
      mapping.creditColumn === null
        ? null
        : parseAmount(raw[mapping.creditColumn] ?? "", mapping.decimalSeparator);

    const byCredit = credit !== null && credit !== 0;
    const bySign = mapping.expenseIsNegative ? value > 0 : value < 0;
    const incoming = byCredit || bySign || incomingByStatus || looksIncoming(type);

    const amount = Math.abs(byCredit ? (credit as number) : value);
    const currency =
      mapping.currencyColumn === null
        ? mapping.currency
        : (matchCurrency(raw[mapping.currencyColumn] ?? "") ?? mapping.currency);

    const row: ImportedRow = {
      spentAt,
      amount,
      currency: currency !== null && CURRENCIES.includes(currency) ? currency : null,
      description: description === "" ? counterparty : description,
      fingerprint: fingerprint(spentAt, amount, description === "" ? counterparty : description),
      kind: classifyOperation(type === "" ? status : type, incoming),
      incoming,
      counterparty,
    };

    rows.push(row);

    if (incoming) {
      incomes++;
      credits.push(row);
    }
  }

  return { rows, skipped, incomes, cancelled, credits, swaps };
}

/**
 * Считается ли операция с таким состоянием состоявшейся.
 *
 * Модель называет допустимые значения сама, но ошибиться ей есть где: колонок
 * со словами в выписке несколько, а формулировки у банков свои. Поэтому её
 * ответ дополнен словарём, и слово отказа перевешивает: пропущенная трата
 * заметна и добавляется руками, а лишняя молча раздувает месяц.
 */
function accepted(status: string, okStatuses: string[]): boolean {
  if (looksRejected(status)) return false;
  if (looksAccepted(status)) return true;

  const clean = status.toLowerCase();
  if (okStatuses.length === 0) return true;

  return okStatuses.some((ok) => ok.trim().toLowerCase() === clean);
}

/**
 * Есть ли в строках настоящие названия операций.
 *
 * Выписка криптокошелька выглядит как обычная таблица, но в колонке описания
 * у неё два слова на тысячу строк — WITHDRAW и SWAP. Категории из такого не
 * достать ничем: ни правилами, ни моделью. Лучше сказать об этом до импорта,
 * чем оставить человека с тысячей одинаковых «Прочее».
 *
 * Это подсказка, а не запрет: короткая выписка из десяти покупок в одном
 * магазине тоже даст мало разных названий, и импортировать её всё равно нужно.
 */
export function describesMerchants(rows: ImportedRow[]): boolean {
  if (rows.length < 30) return true;

  const names = new Set<string>();
  for (const row of rows) {
    const name = row.description.trim().toLowerCase();
    if (name !== "") names.add(name);
  }

  // Пустых названий больше половины — брать категории неоткуда.
  if (names.size === 0) return false;

  return names.size >= Math.max(5, rows.length * 0.05);
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
