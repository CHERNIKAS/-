import {
  type ClassifyInput,
  type ClassifyResult,
  LOW_CONFIDENCE,
  ClassifyError,
} from "./ai/classify.js";
import { FALLBACK_CATEGORY_SLUG } from "./categories.js";
import { type Rule, findRule, normalizePattern } from "./rules.js";

export type Decision = {
  slug: string;
  /** Откуда взялась категория — видно и в карточке, и в логах. */
  source: "rule" | "model" | "fallback";
  confidence: number | null;
  /** Бот показывает кнопки вместо того, чтобы решать молча. */
  ask: boolean;
  /** Модель не ответила: воркер вернётся к трате позже. */
  needsReview: boolean;
  merchant: string;
};

export type CategorizeDeps = {
  /** Правила этого пользователя, категории уже сведены к slug. */
  rules: (Rule & { slug: string })[];
  classify: (input: ClassifyInput) => Promise<ClassifyResult>;
};

/**
 * Три слоя, выстроенные по скорости.
 *
 * Правило отвечает мгновенно и бесплатно. Модель — за секунду, и её ответ тут
 * же становится правилом. Если модель недоступна, трата всё равно сохраняется:
 * сумма и валюта уже разобраны локально, категория ставится временная, а
 * дораспределением займётся фоновая задача.
 */
export async function categorize(
  input: ClassifyInput,
  deps: CategorizeDeps,
): Promise<Decision> {
  const rule = findRule(input.merchant, deps.rules);
  if (rule) {
    return {
      slug: (rule as Rule & { slug: string }).slug,
      source: "rule",
      confidence: null,
      ask: false,
      needsReview: false,
      merchant: input.merchant,
    };
  }

  try {
    const result = await deps.classify(input);
    return {
      slug: result.slug,
      source: "model",
      confidence: result.confidence,
      ask: result.confidence < LOW_CONFIDENCE,
      needsReview: false,
      merchant: result.merchant === "" ? input.merchant : result.merchant,
    };
  } catch (error) {
    if (!(error instanceof ClassifyError)) throw error;

    return {
      slug: FALLBACK_CATEGORY_SLUG,
      source: "fallback",
      confidence: null,
      ask: false,
      needsReview: true,
      merchant: input.merchant,
    };
  }
}

/** Ключ, под которым решение запоминается как правило. */
export function ruleKeyFor(merchant: string): string {
  return normalizePattern(merchant);
}
