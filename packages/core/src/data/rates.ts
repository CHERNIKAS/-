import type { Currency } from "../index.js";
import { CURRENCIES } from "../index.js";
import { and, asc, desc, eq, lte } from "drizzle-orm";
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

  // Выписка бывает старше самого учёта: тогда курса раньше траты нет вовсе.
  // Самый ранний известный ближе к правде, чем сегодняшний, и, что важнее, не
  // заставляет лезть в сеть на каждую строку файла.
  const earliest = await db.query.rates.findFirst({
    where: eq(schema.rates.currency, currency),
    orderBy: asc(schema.rates.day),
  });
  if (earliest) return Number(earliest.toUsd);

  // Курса нет ни в базе, ни в сети. Единица здесь молча превращала гривну в
  // доллар — лучше честно не сохранить, чем записать сумму в сорок раз больше.
  const fetched = await refreshRates();
  const rate = fetched[currency];
  if (rate === undefined) throw new Error(`нет курса ${currency}: источники недоступны`);
  return rate;
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

/**
 * Курсы к доллару из трёх источников по очереди.
 *
 * У ЕЦБ, запасного источника, нет гривны: если падал основной, гривна неделями
 * считалась по последнему сохранённому курсу. НБУ гривну знает всегда — он
 * дописывается и когда нужен вместо всех, и когда у запасного её не хватает.
 */
async function fetchPerUsd(): Promise<Record<string, number>> {
  try {
    const response = await fetch(PRIMARY, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const data = (await response.json()) as { rates?: Record<string, number> };
      if (data.rates) return data.rates;
    }
  } catch {
    // Резервные источники ниже — молча, потому что это ожидаемый сценарий.
  }

  let rates: Record<string, number> = {};

  try {
    const response = await fetch(FALLBACK, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const data = (await response.json()) as { rates?: Record<string, number> };
      if (data.rates) rates = { USD: 1, ...data.rates };
    }
  } catch {
    // Упал и ЕЦБ — остаётся НБУ.
  }

  if (rates["UAH"] === undefined) {
    const national = await fetchNbu().catch(() => ({}) as Record<string, number>);
    rates = { ...national, ...rates };
  }

  if (Object.keys(rates).length === 0) throw new Error("все источники курсов недоступны");
  return rates;
}

const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";

/**
 * Курсы НБУ, пересчитанные к доллару.
 *
 * НБУ отдаёт, сколько гривен стоит единица валюты. Нам нужно, сколько единиц
 * валюты дают за доллар: делим гривны за доллар на гривны за валюту.
 */
async function fetchNbu(): Promise<Record<string, number>> {
  const response = await fetch(NBU, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`НБУ ответил ${response.status}`);

  const list = (await response.json()) as { cc?: string; rate?: number }[];
  const uahPerUnit = new Map(
    list.filter((r) => r.cc && r.rate && r.rate > 0).map((r) => [r.cc as string, r.rate as number]),
  );

  const uahPerUsd = uahPerUnit.get("USD");
  if (uahPerUsd === undefined) throw new Error("у НБУ нет курса доллара");

  const result: Record<string, number> = { USD: 1, UAH: uahPerUsd };
  for (const [code, uah] of uahPerUnit) {
    if (code !== "USD") result[code] = uahPerUsd / uah;
  }

  return result;
}
