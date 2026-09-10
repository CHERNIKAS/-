import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

/**
 * Чтение файла выписки в таблицу строк.
 *
 * Все три формата сводятся к одному виду — массиву строк из ячеек. Дальше
 * разбор одинаковый, и логика не размножается по форматам.
 */

export type Sheet = string[][];

export type ReadResult = {
  rows: Sheet;
  /** Как файл прочитан — попадает в предпросмотр, чтобы было видно источник. */
  format: "csv" | "xlsx" | "pdf";
};

export async function readStatement(file: Uint8Array, filename: string): Promise<ReadResult> {
  const name = filename.toLowerCase();

  if (name.endsWith(".pdf")) return { rows: await readPdf(file), format: "pdf" };
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return { rows: readExcel(file), format: "xlsx" };
  }

  return { rows: readCsv(new TextDecoder("utf-8").decode(file)), format: "csv" };
}

/**
 * CSV с автоопределением разделителя.
 *
 * Банки одинаково охотно отдают и запятую, и точку с запятой, и табуляцию,
 * причём точка с запятой встречается чаще там, где в числах запятая.
 */
export function readCsv(text: string): Sheet {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [";", "\t", ","]
    .map((d) => ({ d, count: sample.split(d).length }))
    .sort((a, b) => b.count - a.count)[0]?.d ?? ",";

  return lines.map((line) => splitCsvLine(line, delimiter));
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;

    if (ch === '"') {
      // Две кавычки подряд внутри поля — это экранированная кавычка.
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }

    if (!quoted && ch === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function readExcel(file: Uint8Array): Sheet {
  const book = XLSX.read(file, { type: "array", cellDates: false, raw: false });
  const first = book.SheetNames[0];
  if (first === undefined) return [];

  const sheet = book.Sheets[first];
  if (sheet === undefined) return [];

  return XLSX.utils
    .sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false })
    .map((row) => row.map((cell) => String(cell ?? "").trim()));
}

/**
 * PDF: текстовый слой построчно.
 *
 * На сканах без текстового слоя вернётся пусто — это честнее, чем выдумывать
 * содержимое.
 */
async function readPdf(file: Uint8Array): Promise<Sheet> {
  const document = await getDocumentProxy(file);
  const { text } = await extractText(document, { mergePages: true });

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return joinRecords(lines).map(splitPdfLine);
}

/** Строка начинается с даты — значит, это начало новой операции. */
const STARTS_WITH_DATE = /^(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\b/u;

/**
 * Склейка операции из нескольких строк.
 *
 * В выписке ПУМБ одна операция разложена на три строки: дата, потом время с
 * суммами, потом хвост названия. По отдельности это мусор: в строке с датой нет
 * суммы, в строке с суммой нет даты. Собираем обратно — новая операция
 * начинается там, где строка начинается с даты.
 */
function joinRecords(lines: string[]): string[] {
  const records: string[] = [];

  for (const line of lines) {
    if (STARTS_WITH_DATE.test(line) || records.length === 0) {
      records.push(line);
      continue;
    }

    const current = records[records.length - 1] ?? "";

    // Пока в операции нет ни одной суммы, следующая строка — её продолжение:
    // в этой выписке дата и суммы стоят на разных строках. Когда сумма уже
    // есть, продолжением считается только короткий хвост вроде «TRTR Покупка».
    // Длинная строка после суммы — это подвал: итоги, реквизиты, оговорки.
    const hasMoney = MONEY.test(current);
    MONEY.lastIndex = 0;

    if (hasMoney && line.length > 24) continue;

    records[records.length - 1] = `${records[records.length - 1]} ${line}`;
  }

  return records;
}

/**
 * Строка операции в PDF — сплошной текст без табуляций.
 *
 * Форматов два, и оба разбираются по форме, а не по пробелам: в названии
 * магазина пробелов сколько угодно.
 *
 * Простой: «2026.06.01, 20:05 MIGROS,ISTANBUL,TUR -5.39 USDC» — дата, название,
 * сумма с валютой.
 *
 * Банковский: в строке несколько сумм подряд — в валюте операции, в валюте
 * счёта и комиссия, — потом номер карты, название и вид операции в конце. Там
 * колонки достаются по порядку: сумма всегда идёт со своей валютой, а карта
 * узнаётся по звёздочкам.
 */
export function splitPdfLine(line: string): string[] {
  const rich = splitRichLine(line);
  if (rich !== null) return rich;

  const match = PDF_LINE.exec(line);
  if (match === null) return line.split(/\s{2,}|	/).map((cell) => cell.trim());

  const [, date, time, title, amount, currency] = match;

  return [
    date ?? "",
    time ?? "",
    (title ?? "").trim(),
    (amount ?? "").replace(/\s/g, ""),
    currency ?? "",
  ];
}

/**
 * Пара «сумма и её валюта»: 108.00 TRY, 1 234,56 UAH.
 *
 * Взгляд назад обязателен: рядом в строке стоят время и дата, и без него
 * «23:15:38 108.00» читалось как одно число 38 108,00 — секунды превращались
 * в тысячи.
 */
const MONEY = /(?<![\d.,:\-/])(\d{1,3}(?:[\s ]\d{3})*(?:[.,]\d{1,2})?)\s+([A-Z]{3})\b/gu;

/**
 * Колонки всегда на одних местах, даже если чего-то в строке нет: карта
 * определяет, где кончаются числа и начинается название, а вид операции — это
 * последнее слово, по нему потом отсеиваются проверки карты и зачисления.
 */
function splitRichLine(line: string): string[] | null {
  const start = STARTS_WITH_DATE.exec(line);
  if (start === null) return null;

  const money = [...line.matchAll(MONEY)];
  if (money.length < 2) return null;

  const card = /\d{4,6}\*{2,}\d{2,4}/u.exec(line);
  if (card === null) return null;

  const time = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/u.exec(line);
  const tail = line.slice((card.index ?? 0) + card[0].length).trim();

  // Вид операции — последнее слово хвоста; «Перевірка рахунку» из двух, но
  // первого слова достаточно, чтобы отличить её от покупки.
  const words = tail.split(/\s+/);
  const kind = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  const title = words.slice(0, Math.max(1, words.length - 1)).join(" ");

  const amount = (index: number) => (money[index]?.[1] ?? "").replace(/[\s ]/g, "");
  const currency = (index: number) => money[index]?.[2] ?? "";

  return [
    start[0],
    time?.[1] ?? "",
    amount(0),
    currency(0),
    amount(1),
    currency(1),
    amount(2),
    currency(2),
    card[0],
    title,
    kind,
  ];
}


const PDF_LINE =
  /^(\d{2,4}[.\-/]\d{1,2}[.\-/]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)?\s*(.*?)\s+([+-]?\d[\d\s.,]*)\s*([A-Za-z]{3,5})?$/u;
