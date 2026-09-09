import "dotenv/config";
import { CATEGORY_SEED, classifyBatch, cleanMerchant } from "../packages/core/src/index.js";

const raw = [
  "SUMUP *MIGROS 34XXX IST TR",
  "STARBUCKS KADIKOY IST TR 4432",
  "BIM BIRLESIK MAGAZALAR A.S.",
  "IBB ISTANBULKART DOLUM",
  "NETFLIX.COM 866-579-7172",
  "ECZANE MELTEM IST",
  "SHELL PETROL 0212 ISTANBUL",
  "AMAZON EU S.A R.L. LUX",
  "TURKCELL FATURA ODEME",
  "KIRA ODEMESI EFT 09/2026",
  "PATI VET KLINIK",
  "OPENAI *CHATGPT SUBSCR",
];

const categories = CATEGORY_SEED.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint }));
const cleaned = raw.map(cleanMerchant);

const t0 = Date.now();
const result = await classifyBatch(cleaned, categories, {
  apiKey: process.env.GEMINI_API_KEY ?? "",
  model: process.env.AI_MODEL ?? "gemini-3.1-flash-lite",
});

console.log(`один запрос на ${cleaned.length} названий, ${Date.now() - t0}мс\n`);
for (let i = 0; i < raw.length; i++) {
  const clean = cleaned[i] as string;
  const slug = result.get(clean);
  const title = CATEGORY_SEED.find((c) => c.slug === slug)?.title ?? "не определено";
  console.log(`${raw[i]?.padEnd(34).slice(0, 34)} → ${title}`);
}
