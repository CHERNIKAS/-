import { PALETTE, type Currency, donutSvg } from "@costnote/core";
import { Resvg } from "@resvg/resvg-js";
import { InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import { escapeHtml, moneyShort } from "../format.js";
import { PERIOD_KEYS, PERIOD_TITLE, type PeriodKey, buildPeriod } from "../periods.js";
import { byCategory, byCurrency, expenseCount, totalUsd } from "../repo/analytics.js";
import { rateToUsd, today } from "../repo/rates.js";
import type { AppUser } from "../repo/users.js";

/**
 * Аналитика — одно сообщение с картинкой.
 *
 * Периоды переключаются заменой текста и изображения в нём же, поэтому чат не
 * растёт, сколько бы раз человек ни ткнул в кнопки.
 */

export const analyticsAction = (key: PeriodKey) => `a:${key}`;

export function periodKeyboard(active: PeriodKey): InlineKeyboard {
  const kb = new InlineKeyboard();
  PERIOD_KEYS.forEach((key, i) => {
    const title = key === active ? `· ${PERIOD_TITLE[key]} ·` : PERIOD_TITLE[key];
    kb.text(title, analyticsAction(key));
    if (i % 3 === 2) kb.row();
  });
  return kb;
}

type Rendered = { png: Buffer; caption: string };

async function render(user: AppUser, ledgerId: number, key: PeriodKey): Promise<Rendered> {
  const todayDay = today();
  const period = buildPeriod(key, todayDay);
  const base = user.currency as Currency;
  const baseRate = await rateToUsd(base, todayDay);

  const [categories, currencies, total, count] = await Promise.all([
    byCategory(ledgerId, period),
    byCurrency(ledgerId, period),
    totalUsd(ledgerId, period),
    expenseCount(ledgerId, period),
  ]);

  const inBase = (usd: number) => usd / baseRate;

  const segments = categories.map((c, i) => ({
    label: c.title,
    value: c.totalUsd,
    color: PALETTE[i % PALETTE.length] as string,
  }));

  const svg = donutSvg(segments, {
    total: moneyShort(inBase(total), base),
    caption: period.label,
    legendRows: Math.min(segments.length, 6),
  });

  // Рендерим с запасом по плотности: Telegram показывает картинку во всю
  // ширину пузыря и на плотных экранах растягивает её, а не ужимает.
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 1040 },
    background: "#2A1B57",
    font: { loadSystemFonts: true, defaultFontFamily: "Noto Sans" },
  })
    .render()
    .asPng();

  const lines = [`<i>📊 ${escapeHtml(period.label)}</i>`];

  if (count === 0) {
    lines.push("", "<i>трат нет</i>");
    return { png, caption: lines.join("\n") };
  }

  lines.push(`<code>${moneyShort(inBase(total), base)}</code>`, "——————");

  for (const c of categories.slice(0, 8)) {
    lines.push(
      `${c.emoji} ${escapeHtml(c.title)}  <code>${moneyShort(inBase(c.totalUsd), base)}</code>`,
    );
  }

  // Разрез «как вносил» имеет смысл только при нескольких валютах: при одной
  // он дословно повторяет общую сумму.
  if (currencies.length > 1) {
    lines.push("", "<i>как вносил</i>");
    for (const c of currencies) {
      lines.push(
        `<code>${moneyShort(c.amount, c.currency)}</code> <i>≈ ${moneyShort(inBase(c.totalUsd), base)}</i>`,
      );
    }
  }

  return { png, caption: lines.join("\n") };
}

export async function sendAnalytics(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  key: PeriodKey = "d30",
): Promise<void> {
  const { png, caption } = await render(user, ledgerId, key);

  await ctx.replyWithPhoto(new InputFile(png, "analytics.png"), {
    caption,
    parse_mode: "HTML",
    reply_markup: periodKeyboard(key),
  });
}

/** Переключение периода: та же картинка и та же подпись, но другие данные. */
export async function switchPeriod(
  ctx: Context,
  user: AppUser,
  ledgerId: number,
  key: PeriodKey,
): Promise<void> {
  const { png, caption } = await render(user, ledgerId, key);

  await ctx.editMessageMedia(
    {
      type: "photo",
      media: new InputFile(png, "analytics.png"),
      caption,
      parse_mode: "HTML",
    },
    { reply_markup: periodKeyboard(key) },
  );
}
