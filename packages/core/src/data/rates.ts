import type { Currency } from "../index.js";
import { CURRENCIES } from "../index.js";
import { and, desc, eq, lte } from "drizzle-orm";
import { db, schema } from "./db.js";

/**
 * Курсы к доллару по датам.
 *
 * У траты курс фиксируется в момент создания и больше не меняется, поэтому
 * переключение валюты отображения не переписывает историю. Здесь же ответ на
 * вопрос «а если сервис курсов умрёт»: всё, что однажды скачано, остаётся в
 * своей таблице навсегда.
 */

const PRIMARY = "https://open.er-api.com/v6/latest/USD";
const FALLBACK = "https://api.frankfurter.app/latest?from=USD";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Сколько долларов стоит одна единица валюты на указанную дату. */
export async function rateToUsd(currency: Currency, day: string): Promise<number> {
  if (currency === "USD") return 1;

  const exact = await db.query.rates.findFirst({
    where: and(eq(schema.rates.currency, currency), eq(schema.rates.day, day)),
  });
  if (exact) return Number(exact.toUsd);

  // Курса за нужный день нет — берём последний известный до него. Это лучше,
  // чем отказываться сохранять трату из-за отсутствующей котировки.
  const previous = await db.query.rates.findFirst({
    where: and(eq(schema.rates.currency, currency), lte(schema.rates.day, day)),
    orderBy: desc(schema.rates.day),
  });
  if (previous) return Number(previous.toUsd);

  const fetched = await refreshRates();
  return fetched[currency] ?? 1;
}

type RatesMap = Partial<Record<Currency, number>>;

/** Тянет свежие курсы и складывает в базу. Вызывается раз в сутки по расписанию. */
export async function refreshRates(): Promise<RatesMap> {
  const perUsd = await fetchPerUsd();
  const day = today();
  const result: RatesMap = {};

  for (const currency of CURRENCIES) {
    const perOneUsd = currency === "USD" ? 1 : perUsd[currency];
    if (perOneUsd === undefined || perOneUsd <= 0) continue;

    // Внешние сервисы отдают «сколько валюты за доллар», а нам удобнее
    // обратное: сколько долларов стоит единица валюты.
    const toUsd = 1 / perOneUsd;
    result[currency] = toUsd;

    await db
      .insert(schema.rates)
      .values({ day, currency, toUsd: toUsd.toFixed(8) })
      .onConflictDoUpdate({
        target: [schema.rates.day, schema.rates.currency],
        set: { toUsd: toUsd.toFixed(8) },
      });
  }

  return result;
}

async function fetchPerUsd(): Promise<Record<string, number>> {
  try {
    const response = await fetch(PRIMARY, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const data = (await response.json()) as { rates?: Record<string, number> };
      if (data.rates) return data.rates;
    }
  } catch {
    // Резервный источник ниже — молча, потому что это ожидаемый сценарий.
  }

  const response = await fetch(FALLBACK, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`курсы недоступны: ${response.status}`);

  const data = (await response.json()) as { rates?: Record<string, number> };
  if (!data.rates) throw new Error("резервный источник вернул пустые курсы");
  return data.rates;
}
