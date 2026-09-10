import type { Currency } from "../currencies.js";
import { fetchWithRetry } from "./retry.js";
import { ClassifyError } from "./classify.js";

/**
 * Разбор месяца.
 *
 * Единственное место, где модель делает то, чего не сделает обычный запрос к
 * базе: три-четыре наблюдения человеческим языком вместо таблицы. Поэтому в
 * запрос уходят агрегаты, а не сырые траты — модели нужно сравнивать месяцы,
 * а не пересчитывать копейки.
 */

export type MonthTotals = {
  month: string;
  total: number;
  byCategory: { title: string; total: number; count: number }[];
};

export type DigestInput = {
  currency: Currency;
  current: MonthTotals;
  previous: MonthTotals[];
};

export type DigestOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export function buildDigestPrompt(input: DigestInput): string {
  const month = (m: MonthTotals) =>
    [
      `${m.month}: всего ${m.total.toFixed(0)} ${input.currency}`,
      ...m.byCategory.map((c) => `  ${c.title}: ${c.total.toFixed(0)} (${c.count} трат)`),
    ].join("\n");

  return [
    "Ты разбираешь личные траты за месяц и пишешь короткие наблюдения.",
    "",
    "Закончившийся месяц:",
    month(input.current),
    "",
    "Предыдущие месяцы для сравнения:",
    ...input.previous.map(month),
    "",
    "Правила:",
    "1. Три наблюдения, каждое — одно предложение, максимум 14 слов.",
    "2. Каждое должно опираться на конкретные числа из данных выше.",
    "3. Пиши то, чего не видно из таблицы: что изменилось, что стало",
    "   регулярным, где расход выбился из привычного. Не пересказывай суммы.",
    "4. Не давай советов и не морализируй. Человек сам решит, что с этим делать.",
    "5. Если сравнивать не с чем, честно скажи, что это первый полный месяц.",
    "",
    "Ответ — JSON: { notes: [строка, строка, строка] }",
  ].join("\n");
}

export async function digest(input: DigestInput, options: DigestOptions): Promise<string[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetchWithRetry(doFetch, `${ENDPOINT}/${options.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildDigestPrompt(input) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { notes: { type: "ARRAY", items: { type: "STRING" } } },
            required: ["notes"],
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

    const parsed = JSON.parse(text) as { notes?: unknown };
    if (!Array.isArray(parsed.notes)) throw new ClassifyError("модель вернула не список");

    return parsed.notes.filter((n): n is string => typeof n === "string").slice(0, 4);
  } catch (error) {
    if (error instanceof ClassifyError) throw error;
    throw new ClassifyError("разбор месяца не собрался", error);
  } finally {
    clearTimeout(timer);
  }
}
