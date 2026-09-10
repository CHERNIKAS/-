import { readFileSync } from "node:fs";
import { readStatement, applyMapping } from "@costnote/core/import";

const { rows } = await readStatement(new Uint8Array(readFileSync(process.argv[2] as string)), "x.csv");
const mapping = {
  skipRows: 1, dateColumn: 0, amountColumn: 4, descriptionColumn: 2, creditColumn: null,
  currencyColumn: 5, statusColumn: 3, typeColumn: 2, counterpartyColumn: null,
  okStatuses: ["DONE"], dateOrder: "mdy" as const, decimalSeparator: "." as const,
  expenseIsNegative: true, currency: null, confidence: 1,
};

const r = applyMapping(rows, mapping, "2026-09-10");
const live = new Set(readFileSync(process.argv[3] as string, "utf-8").split(/\r?\n/).filter(Boolean));
const fresh = r.rows.filter((x) => !live.has(x.fingerprint));
console.log("операций:", r.rows.length, "| уже есть в базе:", r.rows.length - fresh.length, "| свежих:", fresh.length);
