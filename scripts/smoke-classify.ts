import "dotenv/config";
import { CATEGORY_SEED, classify, parseEntry } from "../packages/core/src/index.js";

const categories = CATEGORY_SEED.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint }));
const key = process.env.GEMINI_API_KEY ?? "";
const model = process.env.AI_MODEL ?? "gemini-3.1-flash-lite";

const samples = [
  "магаз 15 лир",
  "сиги 120 лир",
  "клод 20 баксов",
  "сервер 18 $",
  "корм коту 1000 лир",
  "kirtasiye 6",
  "заправка 900 лир",
  "netflix 15",
];

console.log(`модель: ${model}\n`);
for (const s of samples) {
  const p = parseEntry(s);
  const t0 = Date.now();
  try {
    const r = await classify(
      { raw: s, merchant: p.merchant, amount: p.amount ?? 0, currency: p.currency ?? "USD", categories },
      { apiKey: key, model },
    );
    const title = CATEGORY_SEED.find((c) => c.slug === r.slug)?.title ?? r.slug;
    console.log(
      `${s.padEnd(20)} → ${title.padEnd(18)} уверенность ${r.confidence.toFixed(2)}  "${r.merchant}"  ${Date.now() - t0}мс`,
    );
  } catch (e) {
    console.log(`${s.padEnd(20)} → ОШИБКА: ${(e as Error).message}`);
  }
}
