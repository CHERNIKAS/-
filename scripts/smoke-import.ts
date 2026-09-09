import "dotenv/config";
import { readFileSync } from "node:fs";
import { CATEGORY_SEED, classifyBatch, cleanMerchant } from "../packages/core/src/index.js";
import { applyMapping, detectMapping, readStatement } from "../packages/core/src/import/index.js";

const path = process.argv[2] as string;
const { rows } = await readStatement(new Uint8Array(readFileSync(path)), path);

const mapping = await detectMapping(rows.slice(0, 20), {
  apiKey: process.env.GEMINI_API_KEY ?? "",
  model: process.env.AI_MODEL ?? "gemini-3.1-flash-lite",
});
console.log("карта формата:", JSON.stringify(mapping), "\n");

const parsed = applyMapping(rows, mapping, "2026-09-09");
const total = parsed.rows.reduce((s, r) => s + r.amount, 0);

console.log(`расходов: ${parsed.rows.length}, приходов: ${parsed.incomes}, не разобрано: ${parsed.skipped}`);
console.log(`сумма расходов: ${total.toFixed(2)}  (в шапке файла: 747.39)\n`);

const unique = [...new Set(parsed.rows.map((r) => cleanMerchant(r.description)))];
console.log(`уникальных мест: ${unique.length}`);

const guessed = await classifyBatch(
  unique,
  CATEGORY_SEED.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint })),
  { apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.AI_MODEL ?? "gemini-3.1-flash-lite" },
);

const byCategory = new Map<string, { count: number; sum: number }>();
for (const row of parsed.rows) {
  const slug = guessed.get(cleanMerchant(row.description)) ?? "other";
  const title = CATEGORY_SEED.find((c) => c.slug === slug)?.title ?? slug;
  const cur = byCategory.get(title) ?? { count: 0, sum: 0 };
  byCategory.set(title, { count: cur.count + 1, sum: cur.sum + row.amount });
}

console.log("\nпо категориям:");
for (const [title, v] of [...byCategory].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${title.padEnd(20)} ${v.count.toString().padStart(3)} трат   ${v.sum.toFixed(2)}`);
}
