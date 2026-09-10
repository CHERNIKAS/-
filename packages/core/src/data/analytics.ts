import type { Currency, Period } from "../index.js";

export type { Period };
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

/**
 * Агрегаты для аналитики.
 *
 * Всё считается в долларах — в них у траты зафиксирован курс на дату покупки.
 * Пересчёт в валюту отображения делается один раз наверху, поэтому смена
 * валюты не трогает ни историю, ни эти запросы.
 */

export type CategoryTotal = {
  slug: string;
  title: string;
  emoji: string;
  totalUsd: number;
};

export type CurrencyTotal = {
  currency: Currency;
  /** Сумма в исходной валюте — как человек её и тратил. */
  amount: number;
  totalUsd: number;
};

function periodFilter(ledgerId: number, period: Period, kind: "expense" | "income" = "expense") {
  return and(
    eq(schema.expenses.ledgerId, ledgerId),
    eq(schema.expenses.kind, kind),
    gte(schema.expenses.spentAt, period.from),
    lte(schema.expenses.spentAt, period.to),
    isNull(schema.expenses.deletedAt),
  );
}

/**
 * Сумма расхода за вычетом возврата.
 *
 * Возврат гасит покупку прямо в её строке, поэтому вычитается везде разом, а
 * не в каждом отчёте по-своему. Полностью возвращённая покупка даёт ноль и
 * просто перестаёт влиять на итоги.
 */
const NET = sql`(${schema.expenses.amount} - ${schema.expenses.refundedAmount})`;

export async function totalUsd(ledgerId: number, period: Period): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${NET} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(periodFilter(ledgerId, period));

  return Number(row?.total ?? 0);
}

export async function byCategory(ledgerId: number, period: Period): Promise<CategoryTotal[]> {
  const totalExpr = sql<string>`coalesce(sum(${NET} * ${schema.expenses.rateToUsd}), 0)`;

  const rows = await db
    .select({
      slug: schema.categories.slug,
      title: schema.categories.title,
      emoji: schema.categories.emoji,
      total: totalExpr,
    })
    .from(schema.expenses)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.expenses.categoryId))
    .where(periodFilter(ledgerId, period))
    .groupBy(schema.categories.slug, schema.categories.title, schema.categories.emoji)
    .orderBy(desc(totalExpr));

  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    emoji: r.emoji,
    totalUsd: Number(r.total),
  }));
}

/**
 * Разрез «как вносил»: суммы по каждой валюте отдельно.
 *
 * Показывает и «сколько всего», и «сколько это было в лирах» — без него
 * мультивалютный учёт превращается в один общий котёл, где не видно, чем
 * человек на самом деле платил.
 */
export async function byCurrency(ledgerId: number, period: Period): Promise<CurrencyTotal[]> {
  const usdExpr = sql<string>`coalesce(sum(${NET} * ${schema.expenses.rateToUsd}), 0)`;

  const rows = await db
    .select({
      currency: schema.expenses.currency,
      amount: sql<string>`coalesce(sum(${NET}), 0)`,
      total: usdExpr,
    })
    .from(schema.expenses)
    .where(periodFilter(ledgerId, period))
    .groupBy(schema.expenses.currency)
    .orderBy(desc(usdExpr));

  return rows.map((r) => ({
    currency: r.currency as Currency,
    amount: Number(r.amount),
    totalUsd: Number(r.total),
  }));
}

/** Доходы за период: отдельной строкой, в «Потрачено» они не входят. */
export async function incomeUsd(ledgerId: number, period: Period): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.expenses.amount} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(periodFilter(ledgerId, period, "income"));

  return Number(row?.total ?? 0);
}

export async function expenseCount(ledgerId: number, period: Period): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(schema.expenses)
    .where(periodFilter(ledgerId, period));

  return Number(row?.count ?? 0);
}
