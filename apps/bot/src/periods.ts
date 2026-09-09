import type { Period } from "./repo/analytics.js";

/** Периоды аналитики. Ключ уходит в callback_data, поэтому короткий. */
export const PERIOD_KEYS = ["day", "week", "d30", "month", "year"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_TITLE: Record<PeriodKey, string> = {
  day: "День",
  week: "Неделя",
  d30: "30 дней",
  month: "Месяц",
  year: "Год",
};

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function buildPeriod(key: PeriodKey, today: string): Period {
  switch (key) {
    case "day":
      return { from: today, to: today, label: "сегодня" };

    case "week":
      return { from: shift(today, 6), to: today, label: "7 дней" };

    case "d30":
      return { from: shift(today, 29), to: today, label: "30 дней" };

    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today, label: "этот месяц" };

    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "этот год" };
  }
}
