import type { Currency } from "../index.js";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

export type Expense = typeof schema.expenses.$inferSelect;
export type Category = typeof schema.categories.$inferSelect;

export async function listCategories(ledgerId: number): Promise<Category[]> {
  return db.query.categories.findMany({
    where: and(eq(schema.categories.ledgerId, ledgerId), isNull(schema.categories.archivedAt)),
    orderBy: schema.categories.sort,
  });
}

export async function categoryBySlug(ledgerId: number, slug: string): Promise<Category | undefined> {
  return db.query.categories.findFirst({
    where: and(eq(schema.categories.ledgerId, ledgerId), eq(schema.categories.slug, slug)),
  });
}

export async function createExpense(values: {
  ledgerId: number;
  userId: number;
  categoryId: number | null;
  amount: number;
  currency: Currency;
  rateToUsd: number;
  spentAt: string;
  merchant: string;
  confidence: number | null;
  needsReview: boolean;
  kind?: "expense" | "income";
  incomeSource?: string | null;
}): Promise<Expense> {
  const [row] = await db
    .insert(schema.expenses)
    .values({
      ledgerId: values.ledgerId,
      userId: values.userId,
      categoryId: values.categoryId,
      amount: values.amount.toFixed(2),
      currency: values.currency,
      rateToUsd: values.rateToUsd.toFixed(8),
      spentAt: values.spentAt,
      merchant: values.merchant.slice(0, 128),
      source: "bot",
      confidence: values.confidence === null ? null : values.confidence.toFixed(2),
      needsReview: values.needsReview,
      kind: values.kind ?? "expense",
      incomeSource: values.incomeSource ?? null,
    })
    .returning();

  if (!row) throw new Error("не удалось сохранить трату");
  return row;
}

export async function setCategory(expenseId: number, categoryId: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({ categoryId, needsReview: false, updatedAt: new Date() })
    .where(eq(schema.expenses.id, expenseId));
}

/** Мягкое удаление: трата исчезает из отчётов, но остаётся в базе. */
export async function softDelete(expenseId: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({ deletedAt: new Date() })
    .where(eq(schema.expenses.id, expenseId));
}

export async function expenseById(expenseId: number): Promise<Expense | undefined> {
  return db.query.expenses.findFirst({ where: eq(schema.expenses.id, expenseId) });
}

/**
 * Поиск покупки, которую гасит возврат.
 *
 * Сверка по сумме, а не по названию: названия у возврата и покупки в выписке
 * часто разные, а сумма — то немногое, что их связывает. Точного совпадения
 * при этом не требуется: между покупкой и возвратом проходит время, и при
 * пересчёте по курсу возвращается «почти столько же» — 3.24 против 3.36.
 *
 * Ищется в пределах допуска и назад по времени: возврат не может опережать
 * покупку. Из подходящих берётся ближайшая по дате — свежая покупка вероятнее
 * прошлогодней на ту же сумму.
 */
export async function findRefundTarget(
  ledgerId: number,
  amount: number,
  currency: Currency,
  spentAt: string,
  description = "",
): Promise<Expense | undefined> {
  const tolerance = refundTolerance(amount);
  const since = new Date(`${spentAt}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - REFUND_WINDOW_DAYS);

  const candidates = await db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      eq(schema.expenses.kind, "expense"),
      eq(schema.expenses.currency, currency),
      isNull(schema.expenses.deletedAt),
      isNull(schema.expenses.refundedAt),
      lte(schema.expenses.spentAt, spentAt),
      gte(schema.expenses.spentAt, since.toISOString().slice(0, 10)),
      gte(schema.expenses.amount, (amount - tolerance).toFixed(2)),
      lte(schema.expenses.amount, (amount + tolerance).toFixed(2)),
    ),
    orderBy: desc(schema.expenses.spentAt),
    limit: 20,
  });

  if (candidates.length === 0) return undefined;

  // Совпадение по названию решает спор: на одну и ту же сумму покупок бывает
  // несколько, и без этого возврат из Amazon мог бы погасить поездку в
  // автобусе. Само по себе название ненадёжно — в выписке у возврата оно
  // часто другое, — но как выбор из уже подходящих по сумме работает точно.
  const named = candidates.find((c) => sameMerchant(c.merchant ?? "", description));

  return named ?? candidates[0];
}

/**
 * Допуск при сверке возврата с покупкой.
 *
 * Только проценты, без крупного порога в копейках: с порогом в полдоллара
 * возврат за проезд на цент подходил бы к любой мелкой покупке в книге.
 */
function refundTolerance(amount: number): number {
  return Math.max(0.02, amount * 0.1);
}

/** Общее значимое слово в названиях: «MIGROS-154203» и «MIGROS ALANYA» — одно место. */
function sameMerchant(left: string, right: string): boolean {
  const words = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4);

  const first = new Set(words(left));
  if (first.size === 0) return false;

  return words(right).some((w) => first.has(w));
}

/** Сколько назад смотреть: за три месяца возвращают почти всё, что вернут. */
const REFUND_WINDOW_DAYS = 90;

/**
 * Возврат гасит покупку.
 *
 * Возвращённая сумма пишется в саму покупку, а не отдельной строкой: так она
 * вычитается из всех отчётов разом и не появляется в доходах.
 */
export async function applyRefund(expenseId: number, amount: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({
      refundedAmount: sql`least(${schema.expenses.amount}, ${schema.expenses.refundedAmount} + ${amount.toFixed(2)})`,
      refundedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.expenses.id, expenseId));
}

/** Сумма трат в долларах за период, от даты включительно. */
export async function totalSince(ledgerId: number, fromDay: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum((${schema.expenses.amount} - ${schema.expenses.refundedAmount}) * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        eq(schema.expenses.kind, "expense"),
        gte(schema.expenses.spentAt, fromDay),
        isNull(schema.expenses.deletedAt),
      ),
    );

  return Number(row?.total ?? 0);
}
