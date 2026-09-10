import "dotenv/config";
import {
  CURRENCIES,
  type Currency,
  categorize,
  classify,
  parseMessage,
  resolveSpentAt,
  DEFAULT_INCOME_SOURCES,
  FALLBACK_CATEGORY_SLUG,
  guessIcon,
  MAX_INCOME_SOURCES,
  MAX_CATEGORIES,
  buildPeriod,
  PERIOD_KEYS,
  type PeriodKey,
} from "@costnote/core";
import {
  type AppUser,
  applyRefund,
  byCategory,
  findRefundTarget,
  incomeUsd,
  byCurrency,
  categoryBySlug,
  createExpense,
  db,
  activeLedgerId,
  createRecurring,
  createSharedLedger,
  deleteRecurring,
  ensureUser,
  expenseById,
  leaveLedger,
  ledgersOf,
  listRecurring,
  removeMember,
  membersOf,
  learnRule,
  listCategories,
  rateToUsd,
  recentCorrections,
  schema,
  setCategory,
  setRecurringActive,
  softDelete,
  today,
  totalSince,
  totalUsd,
  updateUser,
  userRules,
} from "@costnote/core/data";
import cors from "@fastify/cors";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import Fastify from "fastify";
import { z } from "zod";
import { verifyInitData } from "./auth.js";
import {
  type CardData,
  cardText,
  incomeText,
  refundText,
  removeCards,
  sendCard,
  sendPlain,
  updateCard,
} from "./telegram.js";


const BOT_TOKEN = process.env["BOT_TOKEN"] ?? "";
const PORT = Number(process.env["PORT"] ?? 3000);
const BOT_USERNAME = process.env["BOT_USERNAME"] ?? "costnote_bot";

const app = Fastify({ logger: { level: process.env["LOG_LEVEL"] ?? "info" } });
await app.register(cors, { origin: true });

declare module "fastify" {
  interface FastifyRequest {
    user: AppUser;
    ledgerId: number;
  }
}

/**
 * Единственная дверь внутрь: без верной подписи Telegram запрос не проходит
 * дальше. Пользователь опознаётся по ней же, поэтому клиент не может назваться
 * кем-то другим, даже если очень захочет.
 */
app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/api/health") return;

  const initData = request.headers["x-init-data"];
  const tgUser = verifyInitData(typeof initData === "string" ? initData : "", BOT_TOKEN);

  if (tgUser === null) {
    await reply.code(401).send({ error: "нужна подпись Telegram" });
    return;
  }

  const { user, ledgerId } = await ensureUser(tgUser);
  request.user = user;
  request.ledgerId = ledgerId;
});

app.get("/api/health", async () => ({ ok: true }));

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function baseRate(user: AppUser, day: string): Promise<number> {
  return rateToUsd(user.currency as Currency, day);
}


/**
 * Данные карточки для чата.
 *
 * Собираются здесь, а не в боте: приложение теперь тоже шлёт карточки, и текст
 * должен быть один и тот же — иначе трата из чата и трата из приложения
 * выглядели бы по-разному.
 */
async function buildCard(
  user: AppUser,
  ledgerId: number,
  expense: typeof schema.expenses.$inferSelect,
): Promise<CardData> {
  const categories = await listCategories(ledgerId);
  const category = categories.find((c) => c.id === expense.categoryId) ?? null;
  const todayDay = today();
  const base = user.currency as Currency;
  const baseRateNow = await rateToUsd(base, todayDay);
  const amount = Number(expense.amount);

  const [dayUsd, monthUsd] = await Promise.all([
    totalSince(ledgerId, todayDay),
    totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`),
  ]);

  return {
    emoji: category?.emoji ?? "📦",
    categoryTitle: category?.title ?? null,
    amount,
    currency: expense.currency as Currency,
    baseAmount: (amount * Number(expense.rateToUsd)) / baseRateNow,
    baseCurrency: base,
    merchant: expense.merchant ?? "",
    dayLabel: expense.spentAt === todayDay ? "сегодня" : expense.spentAt,
    dayTotal: dayUsd / baseRateNow,
    monthTotal: monthUsd / baseRateNow,
  };
}

/** Свои источники или список по умолчанию — приложению нужен непустой. */
function incomeSourcesOf(user: { incomeSources: string | null }): string[] {
  if (user.incomeSources === null) return DEFAULT_INCOME_SOURCES;

  try {
    const parsed = JSON.parse(user.incomeSources) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
  } catch {
    // Испорченный JSON — не повод ломать экран: покажем список по умолчанию.
  }

  return DEFAULT_INCOME_SOURCES;
}

app.get("/api/state", async (request) => {
  const { user, ledgerId } = request;
  const todayDay = today();
  const rate = await baseRate(user, todayDay);

  const monthPeriod = {
    from: `${todayDay.slice(0, 7)}-01`,
    to: todayDay,
    label: "месяц",
  };

  const [categories, dayUsd, monthUsd, monthIncome, currencies] = await Promise.all([
    listCategories(ledgerId),
    totalSince(ledgerId, todayDay),
    totalSince(ledgerId, monthPeriod.from),
    // Доход отдельной строкой: в «Потрачено» он не входит, но видеть его надо.
    incomeUsd(ledgerId, monthPeriod),
    // Разбивка по валютам за месяц: на главной интересна сумма именно в той
    // валюте, в которой платил, а не только общий пересчёт.
    byCurrency(ledgerId, monthPeriod),
  ]);

  // Сколько операций ждёт ответа «доход или свои деньги»: главная должна об
  // этом напомнить, иначе разбор потеряется в настройках.
  const [pending] = await db
    .select({ count: sql<string>`count(*)` })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        eq(schema.expenses.needsKindReview, true),
        isNull(schema.expenses.deletedAt),
      ),
    );

  const recent = await db.query.expenses.findMany({
    where: and(eq(schema.expenses.ledgerId, ledgerId), isNull(schema.expenses.deletedAt)),
    orderBy: [desc(schema.expenses.spentAt), desc(schema.expenses.id)],
    limit: 20,
  });

  return {
    user: {
      currency: user.currency,
      timezone: user.timezone,
      reminderEnabled: user.reminderEnabled,
      reminderHour: user.reminderHour,
      dailyCleanup: user.dailyCleanup,
      monthlyDigest: user.monthlyDigest,
      monthlyBudget: user.monthlyBudget === null ? null : Number(user.monthlyBudget),
      incomeSources: incomeSourcesOf(user),
      firstName: user.firstName,
    },
    today: todayDay,
    sharedActive: user.activeLedgerId !== null,
    totals: { day: dayUsd / rate, month: monthUsd / rate, income: monthIncome / rate },
    needsReview: Number(pending?.count ?? 0),
    currencies: currencies.map((c) => ({
      currency: c.currency,
      amount: c.amount,
      base: c.totalUsd / rate,
    })),
    categories: categories.map((c) => ({
      slug: c.slug,
      title: c.title,
      emoji: c.emoji,
    })),
    recent: recent.map((e) => serialize(e, categories, rate)),
  };
});

type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

function serialize(
  expense: typeof schema.expenses.$inferSelect,
  categories: CategoryRow[],
  rate: number,
) {
  const category = categories.find((c) => c.id === expense.categoryId) ?? null;
  const amount = Number(expense.amount);

  return {
    id: expense.id,
    amount,
    currency: expense.currency,
    // Пересчёт по курсу на дату покупки: витрина меняется, история — нет.
    base: (amount * Number(expense.rateToUsd)) / rate,
    spentAt: expense.spentAt,
    merchant: expense.merchant ?? "",
    note: expense.note,
    payment: expense.payment,
    // Откуда взялась категория: null — сработало правило пользователя.
    confidence: expense.confidence === null ? null : Number(expense.confidence),
    source: expense.source,
    needsReview: expense.needsReview,
    kind: expense.kind,
    incomeSource: expense.incomeSource,
    // Сколько по этой покупке вернули: строка показывает это отдельно, а из
    // итогов сумма уже вычтена.
    refunded: Number(expense.refundedAmount),
    /** Сколько эта трата весит в итогах: сумма за вычетом возврата. */
    netBase: ((amount - Number(expense.refundedAmount)) * Number(expense.rateToUsd)) / rate,
    category: category === null ? null : { slug: category.slug, title: category.title, emoji: category.emoji },
  };
}

app.get("/api/expenses", async (request) => {
  const query = z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      category: z.string().optional(),
      payment: z.enum(["card", "cash", "transfer"]).optional(),
      limit: z.coerce.number().max(200).default(100),
    })
    .parse(request.query);

  const { user, ledgerId } = request;
  const todayDay = today();
  const from = query.from ?? shiftDay(todayDay, 30);
  const to = query.to ?? todayDay;

  const rate = await baseRate(user, todayDay);
  const categories = await listCategories(ledgerId);

  const category =
    query.category === undefined ? undefined : await categoryBySlug(ledgerId, query.category);

  const rows = await db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      gte(schema.expenses.spentAt, from),
      lte(schema.expenses.spentAt, to),
      isNull(schema.expenses.deletedAt),
      ...(category === undefined ? [] : [eq(schema.expenses.categoryId, category.id)]),
      ...(query.payment === undefined ? [] : [eq(schema.expenses.payment, query.payment)]),
    ),
    orderBy: [desc(schema.expenses.spentAt), desc(schema.expenses.id)],
    limit: query.limit,
  });

  return { expenses: rows.map((e) => serialize(e, categories, rate)) };
});

const createSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  amount: z.number().positive().optional(),
  currency: z.enum(CURRENCIES).optional(),
  categorySlug: z.string().optional(),
  spentAt: z.string().optional(),
  merchant: z.string().max(128).optional(),
  /** Приложение может сказать прямо, что это доход, — без слов в строке. */
  kind: z.enum(["expense", "income"]).optional(),
  incomeSource: z.string().max(32).optional(),
});

/**
 * Создание траты.
 *
 * Строкой или полями — разбор и категоризация одни и те же, что у бота: они
 * живут в общем пакете, и приложение не имеет своей копии этой логики.
 */
app.post("/api/expenses", async (request, reply) => {
  const body = createSchema.parse(request.body);
  const { user, ledgerId } = request;
  const todayDay = today();
  const categories = await listCategories(ledgerId);
  const options = categories.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint }));

  const drafts =
    body.text !== undefined
      ? parseMessage(body.text)
          .filter((e) => e.ok)
          .map((e) => ({
            raw: e.raw,
            merchant: e.merchant,
            amount: e.amount ?? 0,
            // Валюта из строки главнее выбранной в приложении: её написали явно.
            currency: (e.currency ?? body.currency ?? user.currency) as Currency,
            spentAt: resolveSpentAt(e, todayDay),
            // Переключатель в приложении главнее молчания строки: человек
            // выбрал «доход» руками. Но слово «возврат» в строке сильнее и
            // его — оно говорит не «откуда деньги», а «что это вообще».
            kind: e.isRefund ? e.kind : (body.kind ?? e.kind),
            incomeSource: e.incomeSource ?? body.incomeSource ?? null,
            isRefund: e.isRefund,
          }))
      : body.amount !== undefined
        ? [
            {
              raw: body.merchant ?? "",
              merchant: body.merchant ?? "",
              amount: body.amount,
              currency: (body.currency ?? user.currency) as Currency,
              spentAt: body.spentAt ?? todayDay,
              kind: body.kind ?? ("expense" as const),
              incomeSource: body.incomeSource ?? null,
              isRefund: false,
            },
          ]
        : [];

  if (drafts.length === 0) {
    await reply.code(400).send({ error: "не вижу суммы" });
    return;
  }

  const rules = await userRules(user.id);
  const corrections = await recentCorrections(user.id);
  const created = [];

  const refunds: { amount: number; currency: Currency; merchant: string; spentAt: string }[] = [];

  for (const draft of drafts) {
    // Возврат и доход разбираются так же, как в чате: правила одни, иначе одна
    // и та же строка значила бы в двух местах разное.
    if (draft.isRefund) {
      const target = await findRefundTarget(
        ledgerId,
        draft.amount,
        draft.currency,
        draft.spentAt,
        draft.merchant,
      );
      if (target !== undefined) {
        await applyRefund(target.id, draft.amount);
        refunds.push({
          amount: draft.amount,
          currency: draft.currency,
          merchant: target.merchant ?? "",
          spentAt: target.spentAt,
        });
        continue;
      }
    }

    if (draft.kind === "income") {
      const rate = await rateToUsd(draft.currency, draft.spentAt);
      const income = await createExpense({
        ledgerId,
        userId: user.id,
        categoryId: null,
        amount: draft.amount,
        currency: draft.currency,
        rateToUsd: rate,
        spentAt: draft.spentAt,
        merchant: draft.merchant,
        confidence: null,
        needsReview: false,
        kind: "income",
        incomeSource: draft.incomeSource,
      });

      created.push(income);
      continue;
    }

    let slug = body.categorySlug;
    let confidence: number | null = null;
    let needsReview = false;
    let merchant = draft.merchant;

    if (slug === undefined) {
      const decision = await categorize(
        { ...draft, categories: options, recentCorrections: corrections },
        {
          rules,
          classify: (input) =>
            classify(input, {
              apiKey: process.env["GEMINI_API_KEY"] ?? "",
              model: process.env["AI_MODEL"] ?? "gemini-3.1-flash-lite",
            }),
        },
      );
      slug = decision.slug;
      confidence = decision.confidence;
      needsReview = decision.needsReview;
      merchant = decision.merchant;
    }

    const category = await categoryBySlug(ledgerId, slug);
    const rate = await rateToUsd(draft.currency, draft.spentAt);

    const expense = await createExpense({
      ledgerId,
      userId: user.id,
      categoryId: category?.id ?? null,
      amount: draft.amount,
      currency: draft.currency,
      rateToUsd: rate,
      spentAt: draft.spentAt,
      merchant,
      confidence,
      needsReview,
    });

    created.push(expense);
  }

  // Карточка в чат — чтобы трата из приложения выглядела так же, как трата
  // из бота, и всё, что произошло, было видно в одном месте.
  for (const expense of created) {
    if (expense.kind === "income") {
      const amount = Number(expense.amount);
      const base = user.currency as Currency;
      const baseRateValue = await rateToUsd(base, expense.spentAt);

      await sendPlain(
        BOT_TOKEN,
        user.tgId,
        incomeText({
          source: expense.incomeSource ?? "Доход",
          amount,
          currency: expense.currency as Currency,
          baseAmount: (amount * Number(expense.rateToUsd)) / baseRateValue,
          baseCurrency: base,
          dayLabel: expense.spentAt === todayDay ? "сегодня" : expense.spentAt,
        }),
      ).catch(() => undefined);
      continue;
    }

    const card = await buildCard(user, ledgerId, expense);
    await sendCard(BOT_TOKEN, user.tgId, user.id, expense.id, cardText(card)).catch(
      () => undefined,
    );
  }

  // Возврат в чат тоже уходит: иначе трата в приложении молча уменьшилась, и
  // человек ищет, куда делись деньги.
  for (const done of refunds) {
    await sendPlain(
      BOT_TOKEN,
      user.tgId,
      refundText({
        amount: done.amount,
        currency: done.currency,
        merchant: done.merchant,
        dayLabel: done.spentAt === todayDay ? "сегодня" : done.spentAt,
      }),
    ).catch(() => undefined);
  }

  const rate = await baseRate(user, todayDay);
  return { created: created.map((e) => serialize(e, categories, rate)), refunded: refunds.length };
});

const patchSchema = z.object({
  categorySlug: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.enum(CURRENCIES).optional(),
  spentAt: z.string().optional(),
  merchant: z.string().max(128).optional(),
  note: z.string().max(500).nullable().optional(),
  payment: z.enum(["card", "cash", "transfer"]).optional(),
  incomeSource: z.string().max(32).optional(),
});

app.get("/api/expenses/:id", async (request, reply) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  const expense = await expenseById(id);

  if (!expense || expense.ledgerId !== request.ledgerId || expense.deletedAt !== null) {
    await reply.code(404).send({ error: "трата не найдена" });
    return;
  }

  const categories = await listCategories(request.ledgerId);
  const rate = await baseRate(request.user, today());
  return { expense: serialize(expense, categories, rate) };
});

app.patch("/api/expenses/:id", async (request, reply) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  const body = patchSchema.parse(request.body);
  const { user, ledgerId } = request;

  const expense = await expenseById(id);
  if (!expense || expense.ledgerId !== ledgerId || expense.deletedAt !== null) {
    await reply.code(404).send({ error: "трата не найдена" });
    return;
  }

  if (body.categorySlug !== undefined) {
    const category = await categoryBySlug(ledgerId, body.categorySlug);
    if (category) {
      await setCategory(id, category.id);
      // Правка здесь учит систему ровно так же, как правка в боте.
      if (expense.merchant) await learnRule(user.id, expense.merchant, category.id);
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.amount !== undefined) {
    patch["amount"] = body.amount.toFixed(2);
    // Возврат не может быть больше самой покупки: иначе трата начнёт считаться
    // отрицательной и потянет итоги вниз.
    if (Number(expense.refundedAmount) > body.amount) {
      patch["refundedAmount"] = body.amount.toFixed(2);
    }
  }
  if (body.merchant !== undefined) patch["merchant"] = body.merchant;
  if (body.note !== undefined) patch["note"] = body.note;
  if (body.payment !== undefined) patch["payment"] = body.payment;
  if (body.incomeSource !== undefined) patch["incomeSource"] = body.incomeSource;
  if (body.spentAt !== undefined) patch["spentAt"] = body.spentAt;

  if (body.currency !== undefined || body.spentAt !== undefined) {
    const currency = body.currency ?? (expense.currency as Currency);
    const day = body.spentAt ?? expense.spentAt;
    patch["currency"] = currency;
    patch["rateToUsd"] = (await rateToUsd(currency, day)).toFixed(8);
  }

  await db.update(schema.expenses).set(patch).where(eq(schema.expenses.id, id));

  const categories = await listCategories(ledgerId);
  const updated = await expenseById(id);
  const rate = await baseRate(user, today());

  if (updated) {
    const card = await buildCard(user, ledgerId, updated);
    await updateCard(BOT_TOKEN, id, cardText(card)).catch(() => undefined);
  }

  return { expense: updated ? serialize(updated, categories, rate) : null };
});

app.delete("/api/expenses/:id", async (request, reply) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  const expense = await expenseById(id);

  if (!expense || expense.ledgerId !== request.ledgerId) {
    await reply.code(404).send({ error: "трата не найдена" });
    return;
  }

  await softDelete(id);

  // Карточка этой траты в чате должна исчезнуть вместе с ней: иначе в боте
  // остаётся сообщение о трате, которой уже нет.
  await removeCards(BOT_TOKEN, id).catch(() => undefined);

  return { ok: true };
});

app.get("/api/analytics", async (request) => {
  const query = z
    .object({
      period: z.string().default("month"),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .parse(request.query);

  const { user, ledgerId } = request;
  const todayDay = today();

  // Произвольный диапазон приходит датами; пресеты считаются по ключу.
  const period =
    query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to, label: `${query.from} — ${query.to}` }
      : buildPeriod(
          (PERIOD_KEYS.includes(query.period as PeriodKey) ? query.period : "month") as PeriodKey,
          todayDay,
        );

  const key = query.period;
  const rate = await baseRate(user, todayDay);

  const [categories, currencies, total, income] = await Promise.all([
    byCategory(ledgerId, period),
    byCurrency(ledgerId, period),
    totalUsd(ledgerId, period),
    incomeUsd(ledgerId, period),
  ]);

  return {
    period: { key, label: period.label, from: period.from, to: period.to },
    total: total / rate,
    income: income / rate,
    currency: user.currency,
    categories: categories.map((c) => ({
      slug: c.slug,
      title: c.title,
      emoji: c.emoji,
      total: c.totalUsd / rate,
    })),
    byCurrency: currencies.map((c) => ({
      currency: c.currency,
      amount: c.amount,
      base: c.totalUsd / rate,
    })),
  };
});

/**
 * Операции, о которых знает только человек.
 *
 * Приход и перевод сами по себе не говорят, чьи это деньги: одна и та же
 * тысяча с одного и того же адреса бывает и заработком, и собственными
 * деньгами, переложенными с другого кошелька. Ответ не запоминается за
 * адресом намеренно — спрашиваем каждый раз.
 *
 * Группировка по второй стороне нужна только глазу: так тридцать строк с
 * одного адреса видно как один блок, а решение всё равно принимается по
 * каждой операции.
 */
app.get("/api/review", async (request) => {
  const { user, ledgerId } = request;
  const rate = await baseRate(user, today());

  const rows = await db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      eq(schema.expenses.needsKindReview, true),
      isNull(schema.expenses.deletedAt),
    ),
    orderBy: [desc(schema.expenses.spentAt), desc(schema.expenses.id)],
    limit: 400,
  });

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.counterparty ?? row.merchant ?? "";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return {
    total: rows.length,
    groups: [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([counterparty, list]) => ({
        counterparty,
        count: list.length,
        items: list.map((row) => {
          const amount = Number(row.amount);
          return {
            id: row.id,
            amount,
            currency: row.currency,
            base: (amount * Number(row.rateToUsd)) / rate,
            spentAt: row.spentAt,
            merchant: row.merchant ?? "",
            kind: row.kind,
            /** Куда двигались деньги: это и решает, какой вопрос задать. */
            incoming: row.incomeSource === "Приход" || row.kind === "income",
          };
        }),
      })),
  };
});

const reviewSchema = z.object({
  decisions: z
    .array(
      z.object({
        id: z.number().int(),
        kind: z.enum(["expense", "income", "transfer"]),
      }),
    )
    .max(400),
});

app.patch("/api/review", async (request) => {
  const { ledgerId } = request;
  const { decisions } = reviewSchema.parse(request.body);

  for (const decision of decisions) {
    await db
      .update(schema.expenses)
      .set({
        kind: decision.kind,
        needsKindReview: false,
        // Доход без источника выглядел бы недоразобранной строкой.
        incomeSource: decision.kind === "income" ? "Поступления" : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.expenses.id, decision.id), eq(schema.expenses.ledgerId, ledgerId)));
  }

  return { ok: true };
});

const settingsSchema = z.object({
  currency: z.enum(CURRENCIES).optional(),
  timezone: z.string().max(64).optional(),
  reminderEnabled: z.boolean().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  dailyCleanup: z.boolean().optional(),
  monthlyDigest: z.boolean().optional(),
  monthlyBudget: z.number().nonnegative().nullable().optional(),
  incomeSources: z.array(z.string().min(1).max(32)).max(MAX_INCOME_SOURCES).optional(),
});

app.patch("/api/settings", async (request, reply) => {
  const body = settingsSchema.parse(request.body);
  const patch: Record<string, unknown> = { ...body };

  // Пояс приходит строкой от клиента, а по нему считаются «сегодня» и час
  // напоминания: неизвестное значение сломало бы и то, и другое молча.
  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone: body.timezone });
    } catch {
      await reply.code(400).send({ error: "не знаю такого часового пояса" });
      return;
    }
  }

  if (body.monthlyBudget !== undefined) {
    patch["monthlyBudget"] = body.monthlyBudget === null ? null : body.monthlyBudget.toFixed(2);
  }

  // Пустой список означает «верни как было»: остаться совсем без подсказок
  // при вводе дохода — не то, чего человек хочет, нажимая крестики.
  if (body.incomeSources !== undefined) {
    const clean = [...new Set(body.incomeSources.map((t) => t.trim()).filter((t) => t !== ""))];
    patch["incomeSources"] = clean.length === 0 ? null : JSON.stringify(clean);
  }

  await updateUser(request.user.id, patch as Partial<AppUser>);
  return { ok: true };
});


/**
 * Категории с числом трат за 30 дней.
 *
 * Число рядом с названием отвечает на вопрос «а живая ли она»: категории
 * с нулём обычно и есть кандидаты на слияние или удаление.
 */
app.get("/api/categories", async (request) => {
  const { ledgerId } = request;
  const todayDay = today();
  const from = shiftDay(todayDay, 29);

  const categories = await listCategories(ledgerId);

  const counts = await db
    .select({
      categoryId: schema.expenses.categoryId,
      count: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(${schema.expenses.amount} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        gte(schema.expenses.spentAt, from),
        isNull(schema.expenses.deletedAt),
      ),
    )
    .groupBy(schema.expenses.categoryId);

  // Те же цифры для источников дохода: без них строка источника выглядела бы
  // недоделанной рядом с категорией, у которой есть и сумма, и счётчик.
  const incomes = await db
    .select({
      source: schema.expenses.incomeSource,
      count: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(${schema.expenses.amount} * ${schema.expenses.rateToUsd}), 0)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        eq(schema.expenses.kind, "income"),
        gte(schema.expenses.spentAt, from),
        isNull(schema.expenses.deletedAt),
      ),
    )
    .groupBy(schema.expenses.incomeSource);

  const rate = await baseRate(request.user, todayDay);

  return {
    limit: MAX_CATEGORIES,
    sources: incomeSourcesOf(request.user).map((title) => {
      const stat = incomes.find((r) => r.source === title);
      return {
        title,
        count: Number(stat?.count ?? 0),
        total: Number(stat?.total ?? 0) / rate,
      };
    }),
    categories: categories.map((c) => {
      const stat = counts.find((r) => r.categoryId === c.id);
      return {
        slug: c.slug,
        title: c.title,
        emoji: c.emoji,
        count: Number(stat?.count ?? 0),
        total: Number(stat?.total ?? 0) / rate,
      };
    }),
  };
});

app.patch("/api/categories/:slug", async (request, reply) => {
  const { slug } = z.object({ slug: z.string() }).parse(request.params);
  const body = z.object({ title: z.string().min(1).max(64) }).parse(request.body);

  const category = await categoryBySlug(request.ledgerId, slug);
  if (!category) {
    await reply.code(404).send({ error: "категория не найдена" });
    return;
  }

  await db
    .update(schema.categories)
    .set({ title: body.title })
    .where(eq(schema.categories.id, category.id));

  return { ok: true };
});

/**
 * Слияние.
 *
 * Траты и правила переезжают в целевую категорию, исходная уходит в архив.
 * Ничего не удаляется: потерять историю из-за неудачной уборки списка было бы
 * обиднее, чем жить с лишней строкой.
 */
app.post("/api/categories/:slug/merge", async (request, reply) => {
  const { slug } = z.object({ slug: z.string() }).parse(request.params);
  const { into } = z.object({ into: z.string() }).parse(request.body);

  const source = await categoryBySlug(request.ledgerId, slug);
  const target = await categoryBySlug(request.ledgerId, into);

  if (!source || !target || source.id === target.id) {
    await reply.code(400).send({ error: "нечего сливать" });
    return;
  }

  if (source.slug === FALLBACK_CATEGORY_SLUG) {
    await reply.code(400).send({ error: "«Прочее» нельзя убрать: туда падает всё незнакомое" });
    return;
  }

  await db
    .update(schema.expenses)
    .set({ categoryId: target.id })
    .where(eq(schema.expenses.categoryId, source.id));

  await db
    .update(schema.rules)
    .set({ categoryId: target.id })
    .where(eq(schema.rules.categoryId, source.id));

  await db
    .update(schema.categories)
    .set({ archivedAt: new Date() })
    .where(eq(schema.categories.id, source.id));

  return { ok: true };
});

/** Выученные правила: видно, чему бот научился, и любое можно отменить. */
app.get("/api/rules", async (request) => {
  const rows = await db
    .select({
      id: schema.rules.id,
      pattern: schema.rules.pattern,
      hits: schema.rules.hits,
      title: schema.categories.title,
      slug: schema.categories.slug,
    })
    .from(schema.rules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.rules.categoryId))
    .where(eq(schema.rules.userId, request.user.id))
    .orderBy(desc(schema.rules.hits))
    .limit(200);

  return { rules: rows };
});

app.delete("/api/rules/:id", async (request) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);

  await db
    .delete(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.userId, request.user.id)));

  return { ok: true };
});

app.post("/api/categories", async (request, reply) => {
  const body = z
    .object({ title: z.string().min(1).max(64), emoji: z.string().max(8).optional() })
    .parse(request.body);

  // Значок подбирается по названию: с одним значком на всех список категорий
  // превращается в столбик одинаковых квадратов.
  const guessed = guessIcon(body.title);

  // Потолок не про экономию места: с полусотней категорий разрез перестаёт
  // что-либо показывать, и дальше полезнее сливать, а не плодить.
  const existing = await listCategories(request.ledgerId);
  if (existing.length >= MAX_CATEGORIES) {
    await reply.code(400).send({ error: `Больше ${MAX_CATEGORIES} категорий — пора сливать похожие` });
    return;
  }

  const [created] = await db
    .insert(schema.categories)
    .values({
      ledgerId: request.ledgerId,
      slug: `c${Date.now().toString(36)}`,
      title: body.title,
      emoji: body.emoji ?? guessed.emoji,
      sort: 100,
    })
    .returning();

  return { category: created ? { slug: created.slug, title: created.title, emoji: created.emoji } : null };
});


/**
 * Выгрузка в CSV.
 *
 * Файл уходит в Telegram сообщением от бота: скачать что-либо прямо из
 * мини-аппа нельзя — её webview блокирует загрузки. Заодно файл остаётся в
 * переписке, и его не нужно искать в папке «Загрузки».
 */
app.post("/api/export", async (request, reply) => {
  const { user, ledgerId } = request;
  const query = z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .parse(request.body ?? {});

  const todayDay = today();
  const from = query.from ?? `${todayDay.slice(0, 4)}-01-01`;
  const to = query.to ?? todayDay;

  const categories = await listCategories(ledgerId);
  const rows = await db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.ledgerId, ledgerId),
      gte(schema.expenses.spentAt, from),
      lte(schema.expenses.spentAt, to),
      isNull(schema.expenses.deletedAt),
    ),
    orderBy: [schema.expenses.spentAt, schema.expenses.id],
  });

  const header = ["дата", "сумма", "валюта", "курс к USD", "в USD", "категория", "место", "заметка"];
  const lines = [header.join(";")];

  for (const row of rows) {
    const category = categories.find((c) => c.id === row.categoryId);
    const amount = Number(row.amount);
    const rate = Number(row.rateToUsd);

    lines.push(
      [
        row.spentAt,
        amount.toFixed(2).replace(".", ","),
        row.currency,
        rate.toFixed(6).replace(".", ","),
        (amount * rate).toFixed(2).replace(".", ","),
        csv(category?.title ?? ""),
        csv(row.merchant ?? ""),
        csv(row.note ?? ""),
      ].join(";"),
    );
  }

  // BOM нужен, чтобы Excel не превратил кириллицу в мусор.
  const bom = String.fromCharCode(0xfeff);
  const eol = String.fromCharCode(13) + String.fromCharCode(10);
  const file = new Blob([bom + lines.join(eol)], { type: "text/csv" });
  const form = new FormData();
  form.append("chat_id", user.tgId);
  form.append("caption", `Траты с ${from} по ${to} — ${rows.length} шт.`);
  form.append("document", file, `costnote-${from}-${to}.csv`);

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    await reply.code(502).send({ error: "не получилось отправить файл" });
    return;
  }

  return { ok: true, count: rows.length };
});

function csv(value: string): string {
  const clean = value.split(";").join(" ").split(String.fromCharCode(10)).join(" ").trim();
  return clean.includes('"') ? `"${clean.replace(/"/g, '""')}"` : clean;
}


/**
 * Общий бюджет: список книг, участники и ссылка-приглашение.
 *
 * Разницы вкладов здесь намеренно нет — она превращает общий бюджет в
 * взаиморасчёты, а нужен был просто общий котёл.
 */
app.get("/api/ledgers", async (request) => {
  const { user } = request;
  const all = await ledgersOf(user.id);
  const shared = all.find((l) => l.isShared) ?? null;
  const active = await activeLedgerId(user);

  return {
    activeIsShared: shared !== null && active === shared.id,
    shared:
      shared === null
        ? null
        : {
            title: shared.title,
            link: `https://t.me/${BOT_USERNAME}?start=join_${shared.inviteToken}`,
            members: (await membersOf(shared.id)).map((m) => ({
              userId: m.userId,
              name: m.name,
              role: m.role,
            })),
          },
  };
});

app.post("/api/ledgers", async (request) => {
  const { user } = request;
  const existing = (await ledgersOf(user.id)).find((l) => l.isShared);
  const ledger = existing ?? (await createSharedLedger(user));

  await updateUser(user.id, { activeLedgerId: ledger.id });
  return { ok: true };
});

app.post("/api/ledgers/active", async (request) => {
  const { shared } = z.object({ shared: z.boolean() }).parse(request.body);

  if (!shared) {
    await updateUser(request.user.id, { activeLedgerId: null });
    return { ok: true };
  }

  const target = (await ledgersOf(request.user.id)).find((l) => l.isShared);
  if (target === undefined) return { ok: false };

  await updateUser(request.user.id, { activeLedgerId: target.id });
  return { ok: true };
});

app.delete("/api/ledgers/members/:userId", async (request, reply) => {
  const { userId } = z.object({ userId: z.coerce.number() }).parse(request.params);
  const shared = (await ledgersOf(request.user.id)).find((l) => l.isShared);

  if (shared === undefined) {
    await reply.code(404).send({ error: "общего бюджета нет" });
    return;
  }

  const removed = await removeMember(shared.id, request.user.id, userId);
  if (!removed) {
    await reply.code(403).send({ error: "убрать участника может только создатель" });
    return;
  }

  return { ok: true };
});

app.post("/api/ledgers/leave", async (request) => {
  const shared = (await ledgersOf(request.user.id)).find((l) => l.isShared);
  if (shared !== undefined) await leaveLedger(shared.id, request.user.id);
  return { ok: true };
});


/** Регулярные платежи: подписки, аренда, счета. */
app.get("/api/recurring", async (request) => {
  const rows = await listRecurring(request.ledgerId);
  const categories = await listCategories(request.ledgerId);

  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      amount: Number(r.amount),
      currency: r.currency,
      dayOfMonth: r.dayOfMonth,
      active: r.active,
      category: categories.find((c) => c.id === r.categoryId)?.title ?? null,
      categorySlug: categories.find((c) => c.id === r.categoryId)?.slug ?? null,
    })),
  };
});

app.post("/api/recurring", async (request) => {
  const body = z
    .object({
      title: z.string().min(1).max(128),
      amount: z.number().positive(),
      currency: z.enum(CURRENCIES),
      dayOfMonth: z.number().int().min(1).max(28),
      categorySlug: z.string().optional(),
    })
    .parse(request.body);

  const category =
    body.categorySlug === undefined
      ? undefined
      : await categoryBySlug(request.ledgerId, body.categorySlug);

  const created = await createRecurring({
    ledgerId: request.ledgerId,
    userId: request.user.id,
    categoryId: category?.id ?? null,
    title: body.title,
    amount: body.amount,
    currency: body.currency,
    dayOfMonth: body.dayOfMonth,
  });

  return { id: created.id };
});

app.patch("/api/recurring/:id", async (request) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  const { active } = z.object({ active: z.boolean() }).parse(request.body);

  await setRecurringActive(request.ledgerId, id, active);
  return { ok: true };
});

app.delete("/api/recurring/:id", async (request) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  await deleteRecurring(request.ledgerId, id);
  return { ok: true };
});

await app.listen({ port: PORT, host: "0.0.0.0" });
