import { CURRENCIES, type Currency } from "../currencies.js";
import { ClassifyError } from "../ai/classify.js";
import type { Sheet } from "./read.js";

/**
 * Определение формата выписки.
 *
 * Модель видит только первые строки и возвращает карту: какая колонка дата,
 * какая сумма, какая описание. Дальше файл разбирает обычный код.
 *
 * Так сделано намеренно: если отдать модели весь файл, она может переписать
 * сумму, и заметить это будет невозможно. Числа должны попадать в базу из
 * файла байт в байт.
 */

export type Mapping = {
  /** Сколько строк сверху — шапка и мусор. */
  skipRows: number;
  dateColumn: number;
  amountColumn: number;
  descriptionColumn: number;
  /** Отдельная колонка прихода, если расход и приход разнесены. */
  creditColumn: number | null;
  currencyColumn: number | null;
  /** Колонка состояния операции, если она есть. */
  statusColumn: number | null;
  /** Значения статуса, при которых операция считается состоявшейся. */
  okStatuses: string[];
  /** Порядок частей даты в файле. */
  dateOrder: "dmy" | "mdy" | "ymd";
  decimalSeparator: "," | ".";
  /** true — расход записан отрицательным числом. */
  expenseIsNegative: boolean;
  currency: Currency | null;
  confidence: number;
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export function buildDetectPrompt(rows: Sheet): string {
  const sample = rows
    .slice(0, 18)
    .map((row, i) => `${i}: ${row.map((c, j) => `[${j}] ${c}`).join(" | ")}`)
    .join("\n");

  return [
    "Ты разбираешь банковскую выписку. Определи, как устроен файл.",
    "",
    "Первые строки (в скобках — номер колонки):",
    sample,
    "",
    "Правила:",
    "1. skipRows — сколько строк сверху занимают шапка и служебный текст,",
    "   то есть с какой строки начинаются сами операции.",
    "2. Колонки указывай числами из квадратных скобок.",
    "3. creditColumn — только если приход и расход в разных колонках.",
    "   Иначе null.",
    "4. currencyColumn — только если валюта лежит отдельной колонкой.",
    "   Если валюта у всего файла одна, укажи её в currency.",
    "5. expenseIsNegative — true, если расходы записаны со знаком минус.",
    "6. statusColumn — колонка состояния или вида операции, если она есть: там",
    "   стоят значения вроде DONE, CANCELED, PENDING, ПОКУПКА, НАДХОДЖЕННЯ.",
    "   В okStatuses перечисли только те значения, при которых деньги ушли со",
    "   счёта: покупка, оплата, снятие, списание. Приходы и зачисления в этот",
    "   список не входят, даже если операция состоялась.",
    "   Колонки состояния нет — оба поля null и пустой список.",
    "7. confidence — насколько ты уверен, от 0 до 1. Ставь ниже 0.5, если",
    "   структура непонятна: лучше честно не разобрать, чем разобрать неверно.",
    "",
    `Допустимые валюты: ${CURRENCIES.join(", ")}. Другой валюты быть не должно — тогда null.`,
  ].join("\n");
}

export type DetectOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function detectMapping(rows: Sheet, options: DetectOptions): Promise<Mapping> {
  if (rows.length === 0) throw new ClassifyError("файл пустой");

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await doFetch(`${ENDPOINT}/${options.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildDetectPrompt(rows) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              skipRows: { type: "INTEGER" },
              dateColumn: { type: "INTEGER" },
              amountColumn: { type: "INTEGER" },
              descriptionColumn: { type: "INTEGER" },
              creditColumn: { type: "INTEGER", nullable: true },
              currencyColumn: { type: "INTEGER", nullable: true },
              statusColumn: { type: "INTEGER", nullable: true },
              okStatuses: { type: "ARRAY", items: { type: "STRING" } },
              dateOrder: { type: "STRING", enum: ["dmy", "mdy", "ymd"] },
              decimalSeparator: { type: "STRING", enum: [",", "."] },
              expenseIsNegative: { type: "BOOLEAN" },
              currency: { type: "STRING", enum: [...CURRENCIES], nullable: true },
              confidence: { type: "NUMBER" },
            },
            required: [
              "skipRows",
              "dateColumn",
              "amountColumn",
              "descriptionColumn",
              "dateOrder",
              "decimalSeparator",
              "expenseIsNegative",
              "confidence",
            ],
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

    const raw = JSON.parse(text) as Record<string, unknown>;

    return {
      skipRows: num(raw["skipRows"], 0),
      dateColumn: num(raw["dateColumn"], 0),
      amountColumn: num(raw["amountColumn"], 1),
      descriptionColumn: num(raw["descriptionColumn"], 2),
      creditColumn: raw["creditColumn"] === null ? null : num(raw["creditColumn"], -1),
      currencyColumn: raw["currencyColumn"] === null ? null : num(raw["currencyColumn"], -1),
      statusColumn: raw["statusColumn"] === null ? null : num(raw["statusColumn"], -1),
      okStatuses: Array.isArray(raw["okStatuses"])
        ? (raw["okStatuses"] as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      dateOrder: (["dmy", "mdy", "ymd"] as const).includes(raw["dateOrder"] as "dmy")
        ? (raw["dateOrder"] as Mapping["dateOrder"])
        : "dmy",
      decimalSeparator: raw["decimalSeparator"] === "." ? "." : ",",
      expenseIsNegative: raw["expenseIsNegative"] !== false,
      currency: CURRENCIES.includes(raw["currency"] as Currency)
        ? (raw["currency"] as Currency)
        : null,
      confidence: Math.min(1, Math.max(0, num(raw["confidence"], 0))),
    };
  } catch (error) {
    if (error instanceof ClassifyError) throw error;
    throw new ClassifyError("не удалось понять формат файла", error);
  } finally {
    clearTimeout(timer);
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}
