import { CURRENCIES, type Currency } from "@costnote/core";
import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { type AppUser, ledgersOf, updateUser } from "@costnote/core/data";

/**
 * Настройки одним сообщением с переключателями.
 *
 * Каждое нажатие правит это же сообщение — отдельных экранов и подтверждений
 * нет, потому что все переключатели обратимы одним нажатием.
 */

export const SETTINGS_PREFIX = "s:";

const on = (value: boolean) => (value ? "включено" : "выключено");

export function settingsText(user: AppUser): string {
  const lines = [
    "<b>Настройки</b>",
    "",
    `<i>валюта</i>  ${user.currency}`,
    `<i>часовой пояс</i>  ${user.timezone}`,
    `<i>напоминание</i>  ${user.reminderEnabled ? `в ${String(user.reminderHour).padStart(2, "0")}:00` : "выключено"}`,
    `<i>уборка чата</i>  ${on(user.dailyCleanup)}`,
    `<i>разбор месяца</i>  ${on(user.monthlyDigest)}`,
    `<i>пишу в</i>  ${user.activeLedgerId === null ? "личные траты" : "общий бюджет"}`,
  ];

  if (user.dailyCleanup) {
    lines.push(
      "",
      "<i>Раз в сутки карточки вчерашних трат удаляются, вместо них остаётся итог дня. Сами траты никуда не деваются.</i>",
    );
  }

  return lines.join("\n");
}

export function settingsKeyboard(user: AppUser): InlineKeyboard {
  return new InlineKeyboard()
    .text(`Валюта: ${user.currency}`, `${SETTINGS_PREFIX}cur`)
    .row()
    .text(user.reminderEnabled ? "Напоминание: вкл" : "Напоминание: выкл", `${SETTINGS_PREFIX}rem`)
    .row()
    .text("−1 час", `${SETTINGS_PREFIX}hour:-1`)
    .text(`${String(user.reminderHour).padStart(2, "0")}:00`, `${SETTINGS_PREFIX}noop`)
    .text("+1 час", `${SETTINGS_PREFIX}hour:1`)
    .row()
    .text(user.dailyCleanup ? "Уборка чата: вкл" : "Уборка чата: выкл", `${SETTINGS_PREFIX}clean`)
    .row()
    .text(user.monthlyDigest ? "Разбор месяца: вкл" : "Разбор месяца: выкл", `${SETTINGS_PREFIX}digest`)
    .row()
    .text(
      user.activeLedgerId === null ? "Пишу в личные" : "Пишу в общий бюджет",
      `${SETTINGS_PREFIX}ledger`,
    );
}

export async function handleSettingsCallback(ctx: Context, user: AppUser): Promise<boolean> {
  const data = ctx.callbackQuery?.data ?? "";
  if (!data.startsWith(SETTINGS_PREFIX)) return false;

  const [action, arg] = data.slice(SETTINGS_PREFIX.length).split(":");
  const patch: Partial<AppUser> = {};

  switch (action) {
    case "noop":
      await ctx.answerCallbackQuery();
      return true;

    case "cur": {
      const index = CURRENCIES.indexOf(user.currency as Currency);
      patch.currency = CURRENCIES[(index + 1) % CURRENCIES.length] as Currency;
      break;
    }

    case "rem":
      patch.reminderEnabled = !user.reminderEnabled;
      break;

    case "hour": {
      const delta = Number(arg ?? 0);
      patch.reminderHour = (user.reminderHour + delta + 24) % 24;
      break;
    }

    case "clean":
      patch.dailyCleanup = !user.dailyCleanup;
      break;

    case "digest":
      patch.monthlyDigest = !user.monthlyDigest;
      break;

    case "ledger": {
      // Переключатель, а не выбор из списка: книг всего две — личная и общая.
      if (user.activeLedgerId !== null) {
        patch.activeLedgerId = null;
        break;
      }

      const shared = (await ledgersOf(user.id)).find((l) => l.isShared);
      if (shared === undefined) {
        await ctx.answerCallbackQuery("Общего бюджета нет — заведи его командой /invite");
        return true;
      }
      patch.activeLedgerId = shared.id;
      break;
    }

    default:
      await ctx.answerCallbackQuery();
      return true;
  }

  await updateUser(user.id, patch);
  const updated = { ...user, ...patch } as AppUser;

  await ctx.editMessageText(settingsText(updated), {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(updated),
  });
  await ctx.answerCallbackQuery();
  return true;
}
