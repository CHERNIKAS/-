import "dotenv/config";
import {
  CURRENCIES,
  type Currency,
  categorize,
  classify,
  parseMessage,
  FALLBACK_CATEGORY_SLUG,
  MAX_CATEGORIES,
  buildPeriod,
  PERIOD_KEYS,
  type PeriodKey,
} from "@costnote/core";
import {
  type AppUser,
  byCategory,
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

app.get("/api/state", async (request) => {
  const { user, ledgerId } = request;
  const todayDay = today();
  const rate = await baseRate(user, todayDay);

  const [categories, dayUsd, monthUsd] = await Promise.all([
    listCategories(ledgerId),
    totalSince(ledgerId, todayDay),
    totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`),
  ]);

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
      firstName: user.firstName,
    },
    today: todayDay,
    sharedActive: user.activeLedgerId !== null,
    totals: { day: dayUsd / rate, month: monthUsd / rate },
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
            spentAt: shiftDay(todayDay, e.daysAgo),
          }))
      : body.amount !== undefined
        ? [
            {
              raw: body.merchant ?? "",
              merchant: body.merchant ?? "",
              amount: body.amount,
              currency: (body.currency ?? user.currency) as Currency,
              spentAt: body.spentAt ?? todayDay,
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

  for (const draft of drafts) {
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

  const rate = await baseRate(user, todayDay);
  return { created: created.map((e) => serialize(e, categories, rate)) };
});

const patchSchema = z.object({
  categorySlug: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.enum(CURRENCIES).optional(),
  spentAt: z.string().optional(),
  merchant: z.string().max(128).optional(),
  note: z.string().max(500).nullable().optional(),
  payment: z.enum(["card", "cash", "transfer"]).optional(),
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
  if (body.amount !== undefined) patch["amount"] = body.amount.toFixed(2);
  if (body.merchant !== undefined) patch["merchant"] = body.merchant;
  if (body.note !== undefined) patch["note"] = body.note;
  if (body.payment !== undefined) patch["payment"] = body.payment;
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
  return { ok: true };
});

app.get("/api/analytics", async (request) => {
  const query = z
    .object({
      period: z.string().default("d30"),
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
          (PERIOD_KEYS.includes(query.period as PeriodKey) ? query.period : "d30") as PeriodKey,
          todayDay,
        );

  const key = query.period;
  const rate = await baseRate(user, todayDay);

  const [categories, currencies, total] = await Promise.all([
    byCategory(ledgerId, period),
    byCurrency(ledgerId, period),
    totalUsd(ledgerId, period),
  ]);

  return {
    period: { key, label: period.label, from: period.from, to: period.to },
    total: total / rate,
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

const settingsSchema = z.object({
  currency: z.enum(CURRENCIES).optional(),
  timezone: z.string().max(64).optional(),
  reminderEnabled: z.boolean().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  dailyCleanup: z.boolean().optional(),
  monthlyDigest: z.boolean().optional(),
  monthlyBudget: z.number().nonnegative().nullable().optional(),
});

app.patch("/api/settings", async (request) => {
  const body = settingsSchema.parse(request.body);
  const patch: Record<string, unknown> = { ...body };

  if (body.monthlyBudget !== undefined) {
    patch["monthlyBudget"] = body.monthlyBudget === null ? null : body.monthlyBudget.toFixed(2);
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

  const rate = await baseRate(request.user, todayDay);

  return {
    limit: MAX_CATEGORIES,
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
    .object({ title: z.string().min(1).max(64), emoji: z.string().max(8).default("🏷") })
    .parse(request.body);

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
      emoji: body.emoji,
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
            members: (await membersOf(shared.id)).map((m) => ({ name: m.name, role: m.role })),
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

  await setRecurringActive(id, active);
  return { ok: true };
});

app.delete("/api/recurring/:id", async (request) => {
  const { id } = z.object({ id: z.coerce.number() }).parse(request.params);
  await deleteRecurring(id);
  return { ok: true };
});

await app.listen({ port: PORT, host: "0.0.0.0" });
