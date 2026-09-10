import type { Currency } from "../index.js";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { PAIR_WINDOW_DAYS, pairTolerance } from "../import/kinds.js";
import { looksLikeTransfer, sameMerchant } from "../refunds.js";

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
  kind?: "expense" | "income" | "transfer";
  incomeSource?: string | null;
  counterparty?: string | null;
  needsKindReview?: boolean;
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
      counterparty: values.counterparty ?? null,
      needsKindReview: values.needsKindReview ?? false,
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
  options: { requireMerchant?: boolean } = {},
): Promise<Expense | undefined> {
  // Пополнение счёта и обмен — это движение своих же денег, и совпадение с
  // покупкой по сумме тут чистая случайность. Такие строки не гасят ничего.
  if (looksLikeTransfer(description)) return undefined;

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
  // несколько, и без него возврат из Amazon гасил бы поездку в автобусе.
  const named = candidates.find((c) => sameMerchant(c.merchant ?? "", description));

  // В выписке названия обязательны. Там приход — это чаще пополнение карты,
  // чем возврат, и сумма сама по себе ничего не доказывает: пополнение на
  // 19.95 «погасило» покупку на 19.27 просто потому, что числа рядом.
  // Написанному руками «возврат 15 лир» верим и без названия: человек уже
  // сказал, что это возврат.
  if (options.requireMerchant === true) return named;

  return named ?? candidates[0];
}

/**
 * Допуск при сверке возврата с покупкой.
 *
 * Только проценты, без крупного порога в копейках: с порогом в полдоллара
 * возврат за проезд на цент подходил бы к любой мелкой покупке в книге.
 * Пятнадцать — это разброс курса за неделю-другую между покупкой и возвратом:
 * 3.04 уходит и 3.36 возвращается, и это тот же самый заказ.
 */
function refundTolerance(amount: number): number {
  return Math.max(0.02, amount * 0.15);
}

/** Сколько назад смотреть: за три месяца возвращают почти всё, что вернут. */
const REFUND_WINDOW_DAYS = 90;

/**
 * Возврат гасит покупку.
 *
 * Возвращённая сумма пишется в саму покупку, а не отдельной строкой: так она
 * вычитается из всех отчётов разом и не появляется в доходах.
 */
export async function applyRefund(
  expenseId: number,
  amount: number,
  origin: { importId?: number; fingerprint?: string } = {},
): Promise<void> {
  await db
    .update(schema.expenses)
    .set({
      refundedAmount: sql`least(${schema.expenses.amount}, ${schema.expenses.refundedAmount} + ${amount.toFixed(2)})`,
      refundedAt: new Date(),
      refundImportId: origin.importId ?? null,
      refundFingerprint: origin.fingerprint ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.expenses.id, expenseId));
}

/** Гасили ли уже покупку этой самой строкой возврата из выписки. */
export async function refundAlreadyApplied(
  ledgerId: number,
  fingerprint: string,
): Promise<boolean> {
  const row = await db.query.expenses.findFirst({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      eq(schema.expenses.refundFingerprint, fingerprint),
    ),
  });

  return row !== undefined;
}

/**
 * Поиск встречной половины переноса.
 *
 * Одна и та же тысяча уходит с крипты и приходит на карту — в двух выписках
 * это две строки, и без сведения они станут то доходом, то тратой. Ищем по
 * сумме и дате: другого общего у них нет, названия в выписках разные.
 */
export async function findTransferPair(
  ledgerId: number,
  amount: number,
  spentAt: string,
  incoming: boolean,
): Promise<Expense | undefined> {
  const tolerance = pairTolerance(amount);
  const from = shiftDays(spentAt, -PAIR_WINDOW_DAYS);
  const to = shiftDays(spentAt, PAIR_WINDOW_DAYS);

  const candidates = await db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      eq(schema.expenses.kind, "transfer"),
      isNull(schema.expenses.deletedAt),
      isNull(schema.expenses.pairedWithId),
      gte(schema.expenses.spentAt, from),
      lte(schema.expenses.spentAt, to),
      gte(schema.expenses.amount, (amount - tolerance).toFixed(2)),
      lte(schema.expenses.amount, (amount + tolerance).toFixed(2)),
    ),
    limit: 20,
  });

  // Пара — это встречное направление: уход к приходу и наоборот. Направление
  // хранится в самой сумме: у прихода источник заполнен, у ухода пусто.
  return candidates.find((c) => (c.incomeSource === "Приход") !== incoming);
}

/** Обе половины переноса ссылаются друг на друга и уходят из проверки. */
export async function linkTransferPair(left: number, right: number): Promise<void> {
  await db
    .update(schema.expenses)
    .set({ pairedWithId: right, needsKindReview: false })
    .where(eq(schema.expenses.id, left));

  await db
    .update(schema.expenses)
    .set({ pairedWithId: left, needsKindReview: false })
    .where(eq(schema.expenses.id, right));
}

function shiftDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
