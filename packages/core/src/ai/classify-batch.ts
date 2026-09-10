import type { CategoryOption } from "./classify.js";
import { fetchWithRetry } from "./retry.js";
import { ClassifyError } from "./classify.js";

/**
 * Категоризация пачкой.
 *
 * В выписке названия повторяются: триста операций — это обычно полсотни
 * уникальных мест. Спрашивать модель про каждую строку значит превратить
 * импорт в часы ожидания, поэтому спрашиваем один раз про уникальные названия.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Больше сорока названий в одном запросе модель начинает путать местами. */
const CHUNK = 40;

export type BatchOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Названия из банковской выписки шумные: маска карты, город, коды терминала.
 * Для сопоставления с правилами и для запроса модели это лишнее.
 */
export function cleanMerchant(raw: string): string {
  return raw
    .replace(/\*+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\b[A-Z]{2}\d{2,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function classifyBatch(
  merchants: string[],
  categories: CategoryOption[],
  options: BatchOptions,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(merchants.map((m) => m.trim()).filter((m) => m !== ""))];
  const slugs = categories.map((c) => c.slug);

  if (unique.length === 0 || slugs.length === 0) return result;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const answers = await askChunk(chunk, categories, slugs, options);

    for (const [merchant, slug] of answers) result.set(merchant, slug);
  }

  return result;
}

async function askChunk(
  merchants: string[],
  categories: CategoryOption[],
  slugs: string[],
  options: BatchOptions,
): Promise<Map<string, string>> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  const list = categories
    .map((c) => `- ${c.slug}: ${c.title}${c.hint ? ` — ${c.hint}` : ""}`)
    .join("\n");

  const prompt = [
    "Ты разбираешь названия операций из банковской выписки по категориям.",
    "",
    "Категории:",
    list,
    "",
    "Названия (по одному в строке, с номером):",
    ...merchants.map((m, i) => `${i}. ${m}`),
    "",
    "Правила:",
    "1. Для каждого номера выбери ровно один slug из списка выше.",
    "2. Названия из выписки шумные: банк добавляет город, номер терминала и",
    "   маску карты. Ориентируйся на узнаваемую часть.",
    "3. Не понял, что это — ставь категорию для прочего, а не выдумывай.",
    "4. Верни ровно столько элементов, сколько названий.",
  ].join("\n");

  try {
    const response = await fetchWithRetry(doFetch, `${ENDPOINT}/${options.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    index: { type: "INTEGER" },
                    category: { type: "STRING", enum: slugs },
                  },
                  required: ["index", "category"],
                },
              },
            },
            required: ["items"],
          },
        },
      }),
    });

    if (!response.ok) throw new ClassifyError(`Gemini ответил ${response.status}`);

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new ClassifyError("пустой ответ модели");

    const parsed = JSON.parse(text) as { items?: { index?: number; category?: string }[] };
    const map = new Map<string, string>();

    for (const item of parsed.items ?? []) {
      const merchant = merchants[item.index ?? -1];
      // Схема ограничивает категории перечнем, но лишний раз проверяем: на
      // этом значении держится вся дальнейшая логика.
      if (merchant === undefined || item.category === undefined) continue;
      if (!slugs.includes(item.category)) continue;
      map.set(merchant, item.category);
    }

    return map;
  } catch (error) {
    if (error instanceof ClassifyError) throw error;
    throw new ClassifyError("не удалось разобрать названия пачкой", error);
  } finally {
    clearTimeout(timer);
  }
}
