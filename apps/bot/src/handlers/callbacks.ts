import type { Currency } from "@costnote/core";
import type { Context } from "grammy";
import { deleteConfirmation, expenseCard } from "../format.js";
import {
  cardKeyboard,
  categoryPageKeyboard,
  deleteKeyboard,
  quickPickKeyboard,
} from "../keyboards.js";
import {
  categoryBySlug,
  expenseById,
  listCategories,
  setCategory,
  softDelete,
  totalSince,
} from "../repo/expenses.js";
import { rateToUsd, today } from "../repo/rates.js";
import { learnRule } from "../repo/rules.js";
import type { AppUser } from "../repo/users.js";

/**
 * Все действия правят одно и то же сообщение.
 *
 * Карточка превращается в выбор категории, в подтверждение удаления и обратно
 * — новых сообщений не появляется. Из-за этого чат не растёт, а история
 * остаётся читаемой.
 */
export async function handleCallback(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const [, action, rawId, extra] = data.split(":");
  const expenseId = Number(rawId);

  if (action === "noop") {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!Number.isFinite(expenseId)) {
    await ctx.answerCallbackQuery("Не понял, что менять");
    return;
  }

  const expense = await expenseById(expenseId);
  if (!expense || expense.deletedAt !== null) {
    await ctx.answerCallbackQuery("Этой траты уже нет");
    return;
  }

  const categories = await listCategories(ledgerId);
  const current = categories.find((c) => c.id === expense.categoryId) ?? null;

  switch (action) {
    case "edit": {
      await ctx.editMessageReplyMarkup({
        reply_markup: quickPickKeyboard(expenseId, categories, current?.slug ?? null),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    case "all": {
      await ctx.editMessageReplyMarkup({
        reply_markup: categoryPageKeyboard(expenseId, categories, 0, current?.slug ?? null),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    case "page": {
      await ctx.editMessageReplyMarkup({
        reply_markup: categoryPageKeyboard(
          expenseId,
          categories,
          Number(extra ?? 0),
          current?.slug ?? null,
        ),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    case "pick": {
      const category = await categoryBySlug(ledgerId, extra ?? "");
      if (!category) {
        await ctx.answerCallbackQuery("Такой категории нет");
        return;
      }

      await setCategory(expenseId, category.id);

      // Правка — это и есть обучение: со следующего раза строка разберётся
      // мгновенно, без обращения к модели.
      if (expense.merchant) await learnRule(user.id, expense.merchant, category.id);

      await redrawCard(ctx, user, ledgerId, expenseId);
      await ctx.answerCallbackQuery(`Запомнил: ${category.title}`);
      return;
    }

    case "del": {
      await ctx.editMessageText(
        deleteConfirmation({
          amount: Number(expense.amount),
          currency: expense.currency as Currency,
          merchant: expense.merchant ?? "",
        }),
        { parse_mode: "HTML", reply_markup: deleteKeyboard(expenseId) },
      );
      await ctx.answerCallbackQuery();
      return;
    }

    case "delyes": {
      await softDelete(expenseId);
      await ctx.editMessageText("<i>Трата удалена</i>", { parse_mode: "HTML" });
      await ctx.answerCallbackQuery("Удалено");
      return;
    }

    case "back": {
      await redrawCard(ctx, user, ledgerId, expenseId);
      await ctx.answerCallbackQuery();
      return;
    }

    default: {
      await ctx.answerCallbackQuery();
    }
  }
}

async function redrawCard(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  expenseId: number,
): Promise<void> {
  const expense = await expenseById(expenseId);
  if (!expense) return;

  const categories = await listCategories(ledgerId);
  const category = categories.find((c) => c.id === expense.categoryId) ?? null;

  const todayDay = today();
  const base = user.currency as Currency;
  const baseRate = await rateToUsd(base, expense.spentAt);
  const dayTotalUsd = await totalSince(ledgerId, todayDay);
  const monthTotalUsd = await totalSince(ledgerId, `${todayDay.slice(0, 7)}-01`);
  const amount = Number(expense.amount);
  const rate = Number(expense.rateToUsd);

  await ctx.editMessageText(
    expenseCard({
      emoji: category?.emoji ?? "📦",
      categoryTitle: category?.title ?? null,
      amount,
      currency: expense.currency as Currency,
      baseAmount: (amount * rate) / baseRate,
      baseCurrency: base,
      merchant: expense.merchant ?? "",
      day: expense.spentAt,
      todayDay,
      dayTotal: dayTotalUsd / baseRate,
      monthTotal: monthTotalUsd / baseRate,
      lowConfidence: false,
      pending: expense.needsReview,
    }),
    { parse_mode: "HTML", reply_markup: cardKeyboard(expenseId) },
  );
}
