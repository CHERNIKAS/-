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

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(splitPdfLine);
}

/**
 * Строка операции в PDF — сплошной текст без табуляций:
 * «2026.06.01, 20:05 MIGROS-154203,ISTANBUL,TUR -5.39 USDC».
 *
 * Поэтому разбираем её по форме, а не по пробелам: дата в начале, сумма с
 * валютой в конце, всё между ними — название. Делить по пробелам здесь нельзя:
 * в названии магазина их сколько угодно.
 *
 * Не подошло — откатываемся на деление по группам пробелов, как в табличных PDF.
 */
export function splitPdfLine(line: string): string[] {
  const match = PDF_LINE.exec(line);
  if (match === null) return line.split(/\s{2,}|\t/).map((cell) => cell.trim());

  const [, date, time, title, amount, currency] = match;

  return [
    date ?? "",
    time ?? "",
    (title ?? "").trim(),
    (amount ?? "").replace(/\s/g, ""),
    currency ?? "",
  ];
}

const PDF_LINE =
  /^(\d{2,4}[.\-/]\d{1,2}[.\-/]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)?\s*(.*?)\s+([+-]?\d[\d\s.,]*)\s*([A-Za-z]{3,5})?$/u;
