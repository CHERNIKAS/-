import type { Currency } from "../currencies.js";

/**
 * Категоризация моделью — второй слой, для строк, которых нет в правилах.
 *
 * Ключевое здесь не промпт, а схема ответа: категория ограничена перечнем
 * категорий пользователя, поэтому вернуть «не знаю» модель физически не может.
 * Худший исход — трата не в той категории, и он чинится одним тапом, после
 * которого появляется правило и модель для этой строки больше не нужна.
 */

export type CategoryOption = { slug: string; title: string; hint?: string | null };

export type ClassifyInput = {
  /** Исходная строка целиком — в ней бывает контекст, потерянный при разборе. */
  raw: string;
  merchant: string;
  amount: number;
  currency: Currency;
  categories: CategoryOption[];
  /** Последние правки пользователя: модель видит их и не повторяет свои ошибки. */
  recentCorrections?: { merchant: string; slug: string }[];
};

export type ClassifyResult = {
  slug: string;
  /** 0..1. Ниже порога бот спрашивает кнопками вместо того, чтобы решать молча. */
  confidence: number;
  /** Причёсанное название: «клод» → «Claude». Пустая строка, если модель промолчала. */
  merchant: string;
};

export class ClassifyError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ClassifyError";
  }
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const LOW_CONFIDENCE = 0.6;

export function buildPrompt(input: ClassifyInput): string {
  const list = input.categories
    .map((c) => `- ${c.slug}: ${c.title}${c.hint ? ` — ${c.hint}` : ""}`)
    .join("\n");

  const corrections = (input.recentCorrections ?? [])
    .map((c) => `- "${c.merchant}" → ${c.slug}`)
    .join("\n");

  return [
    "Ты разбираешь личные траты. Определи категорию покупки.",
    "",
    "Категории пользователя:",
    list,
    "",
    "Правила:",
    "1. Выбери ровно один slug из списка выше. Придумывать свои нельзя.",
    "2. confidence — насколько ты уверен, от 0 до 1. Ставь ниже 0.6, если",
    "   покупка правдоподобно относится сразу к нескольким категориям или",
    "   название непонятное. Заниженная уверенность лучше уверенной ошибки:",
    "   пользователя переспросят кнопками.",
    "3. merchant — понятное название места или покупки, без суммы и валюты.",
    "   Сленг и сокращения разворачивай: «клод» → «Claude», «сиги» → «сигареты».",
    "   Не уверен в названии — верни пустую строку.",
    corrections === "" ? "" : `\nНедавние правки пользователя, учитывай их:\n${corrections}`,
    "",
    `Трата: "${input.raw}"`,
    `Название после разбора: "${input.merchant}"`,
    `Сумма: ${input.amount} ${input.currency}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export type ClassifyOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function classify(
  input: ClassifyInput,
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  if (input.categories.length === 0) {
    throw new ClassifyError("список категорий пуст");
  }

  const slugs = input.categories.map((c) => c.slug);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await doFetch(`${ENDPOINT}/${options.model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING", enum: slugs },
              confidence: { type: "NUMBER" },
              merchant: { type: "STRING" },
            },
            required: ["category", "confidence", "merchant"],
          },
        },
      }),
    });

    if (!response.ok) {
      throw new ClassifyError(`Gemini ответил ${response.status}`);
    }

    return parseResponse(await response.json(), slugs);
  } catch (error) {
    if (error instanceof ClassifyError) throw error;
    throw new ClassifyError("не удалось получить категорию", error);
  } finally {
    clearTimeout(timer);
  }
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export function parseResponse(payload: unknown, allowedSlugs: string[]): ClassifyResult {
  const text = (payload as GeminiResponse)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new ClassifyError("пустой ответ модели");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ClassifyError("ответ модели не разобрался как JSON", error);
  }

  const obj = parsed as Record<string, unknown>;
  const slug = obj["category"];

  // Схема запрещает модели выдумывать категории, но проверяем всё равно:
  // на этом значении держится вся дальнейшая логика.
  if (typeof slug !== "string" || !allowedSlugs.includes(slug)) {
    throw new ClassifyError(`модель вернула категорию вне списка: ${String(slug)}`);
  }

  const rawConfidence = typeof obj["confidence"] === "number" ? obj["confidence"] : 0;
  const merchant = typeof obj["merchant"] === "string" ? obj["merchant"].trim() : "";

  return {
    slug,
    confidence: Math.min(1, Math.max(0, rawConfidence)),
    merchant,
  };
}
