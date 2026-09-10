export type Period = { from: string; to: string; label: string };

/** Периоды аналитики. Ключ уходит в callback_data, поэтому короткий. */
export const PERIOD_KEYS = ["day", "week", "month", "year"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_TITLE: Record<PeriodKey, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
  year: "Год",
};

/** Понедельник текущей недели: неделя календарная, как и месяц. */
function weekStart(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  return shift(today, (date.getUTCDay() + 6) % 7);
}

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
      return { from: weekStart(today), to: today, label: "эта неделя" };

    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today, label: "этот месяц" };

    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "этот год" };
  }
}
