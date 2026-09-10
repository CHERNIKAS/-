import { type Currency, ClassifyError, classifyBatch, cleanMerchant, findRule } from "@costnote/core";
import { applyMapping, describesMerchants, detectMapping, readStatement } from "@costnote/core/import";
import {
  type AppUser,
  applyRefund,
  createImportPreview,
  findTransferPair,
  linkTransferPair,
  refundAlreadyApplied,
  db,
  findRefundTarget,
  importCredits,
  existingFingerprints,
  importById,
  importRows,
  listCategories,
  markImportApplied,
  cancelImport,
  rateToUsd,
  schema,
  today,
  userRules,
} from "@costnote/core/data";
import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { env } from "../env.js";
import { moneyShort } from "../format.js";
import { storeStatement } from "../statements.js";

const NL = String.fromCharCode(10);

/** Больше этого в одном файле — почти наверняка не выписка за месяц. */
const MAX_ROWS = 3000;

/**
 * Импорт банковской выписки.
 *
 * Формат определяет модель по первым строкам, а сами числа и даты разбирает
 * обычный код: если отдать файл модели целиком, она может переписать сумму, и
 * заметить это будет невозможно.
 */
export async function handleDocument(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
): Promise<void> {
  const document = ctx.msg?.document;
  if (document === undefined) return;

  const name = document.file_name ?? "выписка";
  if (!/\.(csv|xlsx?|pdf|txt)$/i.test(name)) {
    await ctx.reply("Понимаю CSV, XLSX и PDF. Пришли выписку в одном из них.");
    return;
  }

  const status = await ctx.reply("Читаю файл…");

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path ?? ""}`;
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());

    // Сохраняем до разбора: нечитаемые выписки нужны позже больше всего —
    // именно по ним видно, какой формат бот не понял.
    const stored = await storeStatement(user.id, name, bytes);

    const { rows, format } = await readStatement(bytes, name);

    if (rows.length === 0) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        format === "pdf"
          ? "В этом PDF нет текстового слоя — похоже, это скан. Такой файл я прочитать не смогу."
          : "Файл пустой или нечитаемый.",
      );
      return;
    }

    const mapping = await detectMapping(rows.slice(0, 20), {
      apiKey: env.GEMINI_API_KEY,
      model: env.AI_MODEL,
    });

    if (mapping.confidence < 0.5) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Не разобрался в структуре файла. Пришли выгрузку в CSV — её формат понятнее.",
      );
      return;
    }

    const parsed = applyMapping(rows.slice(0, MAX_ROWS), mapping, today());

    if (parsed.rows.length === 0) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Операций в файле не нашлось — возможно, формат оказался мне незнаком.",
      );
      return;
    }

    const known = await existingFingerprints(
      ledgerId,
      parsed.rows.map((r) => r.fingerprint),
    );
    const fresh = parsed.rows.filter((r) => !known.has(r.fingerprint));

    const record = await createImportPreview({
      userId: user.id,
      ledgerId,
      filename: name,
      rows: fresh,
      credits: parsed.credits,
      mapping,
      ...(stored === null ? {} : { storedPath: stored.path, fileSize: stored.size }),
    });

    const base = user.currency as Currency;
    const rate = await rateToUsd(base, today());

    const spending = fresh.filter((r) => r.kind === "expense");
    const moving = fresh.filter((r) => r.kind !== "expense");

    let sumUsd = 0;
    for (const row of spending) {
      const currency = (row.currency ?? base) as Currency;
      sumUsd += row.amount * (await rateToUsd(currency, row.spentAt));
    }

    const first = spending.slice(0, 5);
    const dates = fresh.map((r) => r.spentAt).sort();

    const lines = [
      `<b>${escape(name)}</b>`,
      `${spending.length} трат · ${dates[0]} — ${dates[dates.length - 1]}`,
      `на <code>${moneyShort(sumUsd / rate, base)}</code>`,
      "",
      ...first.map(
        (r) =>
          `<code>${moneyShort(r.amount, (r.currency ?? base) as Currency)}</code> · ${escape(r.description).slice(0, 40)}`,
      ),
      spending.length > 5 ? `<i>…и ещё ${spending.length - 5}</i>` : "",
      "",
      known.size > 0 ? `<i>${known.size} уже есть в базе — пропущу</i>` : "",
      // Переводы и приходы не траты, но и не мусор: их надо будет разобрать.
      moving.length > 0 ? `<i>${moving.length} переводов и приходов — спрошу о них после</i>` : "",
      parsed.swaps > 0 ? `<i>${parsed.swaps} обменов внутри счёта — пропускаю</i>` : "",
      parsed.cancelled > 0 ? `<i>${parsed.cancelled} отменённых операций — не беру</i>` : "",
      parsed.skipped > 0 ? `<i>${parsed.skipped} строк не разобрал</i>` : "",
      // Про отсутствие названий честнее предупредить до импорта, а не после.
      describesMerchants(spending) ? "" : `<i>в файле нет названий операций — категории проставить не из чего</i>`,
    ].filter((line) => line !== "");

    await ctx.api.editMessageText(status.chat.id, status.message_id, lines.join(NL), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text(`Импортировать ${fresh.length}`, `i:apply:${record.id}`)
        .text("Отмена", `i:cancel:${record.id}`),
    });
  } catch (error) {
    console.error("импорт не удался:", error);
    await ctx.api
      .editMessageText(status.chat.id, status.message_id, "Не получилось прочитать файл.")
      .catch(() => undefined);
  }
}

/**
 * Применение импорта.
 *
 * Категории ставятся только выученными правилами, остальное помечается на
 * доразбор: гнать сотни строк через модель прямо сейчас — это минуты ожидания,
 * а фоновый воркер разберёт их сам и незаметно.
 */
export async function applyImport(ctx: Context, user: AppUser, importId: number): Promise<void> {
  const record = await importById(importId);

  if (!record || record.status !== "preview" || record.userId !== user.id) {
    await ctx.answerCallbackQuery("Этот импорт уже неактуален");
    return;
  }

  const rows = importRows(record);
  const categories = await listCategories(record.ledgerId);
  const rules = await userRules(user.id);
  const fallback = categories.find((c) => c.slug === "other");
  const base = user.currency as Currency;

  await ctx.answerCallbackQuery("Разбираю…");

  // Сначала правила — они бесплатны и точны. Всё, чего они не знают, уходит
  // в модель одной пачкой уникальных названий: в выписке одни и те же места
  // повторяются десятками строк, и спрашивать про каждую строку значило бы
  // растянуть импорт на часы.
  const unknown = new Set<string>();
  for (const row of rows) {
    const clean = cleanMerchant(row.description);
    if (findRule(clean, rules) === null) unknown.add(clean);
  }

  let guessed = new Map<string, string>();
  let modelFailed = false;

  if (unknown.size > 0) {
    try {
      guessed = await classifyBatch(
        [...unknown],
        categories.map((c) => ({ slug: c.slug, title: c.title, hint: c.hint })),
        { apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL },
      );
    } catch (error) {
      // Модель недоступна — траты всё равно сохраним, категории добьёт воркер.
      modelFailed = error instanceof ClassifyError;
    }
  }

  let created = 0;
  let moved = 0;
  let paired = 0;

  for (const row of rows) {
    const currency = (row.currency ?? base) as Currency;
    const rate = await rateToUsd(currency, row.spentAt);
    const clean = cleanMerchant(row.description);
    const rule = row.kind === "expense" ? findRule(clean, rules) : null;

    const guessedSlug = rule === null && row.kind === "expense" ? guessed.get(clean) : undefined;
    const category =
      rule !== null
        ? categories.find((c) => c.id === rule.categoryId)
        : guessedSlug === undefined
          ? row.kind === "expense"
            ? fallback
            : undefined
          : categories.find((c) => c.slug === guessedSlug);

    const [saved] = await db
      .insert(schema.expenses)
      .values({
        ledgerId: record.ledgerId,
        userId: user.id,
        categoryId: category?.id ?? null,
        amount: row.amount.toFixed(2),
        currency,
        rateToUsd: rate.toFixed(8),
        spentAt: row.spentAt,
        merchant: row.description.slice(0, 128),
        source: "app",
        confidence: null,
        // На доразбор уходит только то, чего не знают ни правила, ни модель.
        needsReview: row.kind === "expense" && rule === null && guessedSlug === undefined,
        kind: row.kind,
        // Направление переноса хранится там же, где источник дохода: в отчётах
        // эта строка так и читается — «Приход» или «Отправка».
        incomeSource:
          row.kind === "transfer"
            ? row.incoming
              ? "Приход"
              : "Отправка"
            : row.kind === "income"
              ? "Поступления"
              : null,
        counterparty: row.counterparty.slice(0, 128) || null,
        // Перевод ждёт решения, пока не нашлась встречная половина: только
        // человек знает, свои это деньги или чужие.
        needsKindReview: row.kind !== "expense",
        importId: record.id,
        fingerprint: row.fingerprint,
      })
      .returning();

    if (row.kind === "expense") created++;
    else moved++;

    // Пара к переносу могла прийти с выпиской другого счёта — ищем сразу.
    if (row.kind === "transfer" && saved !== undefined) {
      const half = await findTransferPair(record.ledgerId, row.amount, row.spentAt, row.incoming);
      if (half !== undefined) {
        await linkTransferPair(saved.id, half.id);
        paired++;
      }
    }
  }

  // Возвраты гасят прошлые покупки: сверка по сумме, потому что названия у
  // возврата и покупки в выписке обычно разные.
  let refunded = 0;
  for (const credit of importCredits(record)) {
    // Тот же файл, залитый второй раз, не должен гасить покупки повторно.
    if (await refundAlreadyApplied(record.ledgerId, credit.fingerprint)) continue;

    const currency = (credit.currency ?? base) as Currency;
    const target = await findRefundTarget(
      record.ledgerId,
      credit.amount,
      currency,
      credit.spentAt,
      credit.description,
      // В выписке приход — чаще пополнение карты, чем возврат, поэтому без
      // совпадения по названию не гасим ничего.
      { requireMerchant: true },
    );
    if (target === undefined) continue;

    await applyRefund(target.id, credit.amount, {
      importId: record.id,
      fingerprint: credit.fingerprint,
    });
    refunded++;
  }

  await markImportApplied(record.id, created);

  const pending = rows.filter(
    (r) =>
      r.kind === "expense" &&
      findRule(cleanMerchant(r.description), rules) === null &&
      !guessed.has(cleanMerchant(r.description)),
  ).length;

  // Сколько переносов осталось без пары — столько вопросов и предстоит.
  const toReview = moved - paired * 2 < 0 ? 0 : moved - paired * 2;

  await ctx.editMessageText(
    [
      `<b>Импортировано ${created}</b>`,
      "",
      pending === 0
        ? "<i>Категории расставлены</i>"
        : modelFailed
          ? `<i>${pending} трат без категории: модель недоступна, вернусь к ним позже</i>`
          : `<i>${pending} трат ушло в «Прочее» — поправишь, и я запомню</i>`,
      refunded > 0 ? `<i>${refunded} возвратов погасили прошлые покупки</i>` : "",
      paired > 0 ? `<i>${paired} переводов свелись между твоими счетами</i>` : "",
      toReview > 0
        ? `<i>${toReview} приходов и переводов ждут ответа: доход это или свои деньги — разберёшь в приложении</i>`
        : "",
    ]
      .filter((line) => line !== "")
      .join(NL),
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Отменить импорт", `i:undo:${record.id}`),
    },
  );

}

export async function cancelImportFlow(ctx: Context, importId: number): Promise<void> {
  await cancelImport(importId);
  await ctx.editMessageText("<i>Импорт отменён</i>", { parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
