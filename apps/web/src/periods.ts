import { shiftDay } from "./format.js";

/**
 * Периоды.
 *
 * Один набор на все экраны: раньше в разборе и в истории были разные наборы, и
 * это выглядело как два разных приложения. Здесь же живёт произвольный
 * диапазон.
 *
 * «30 дней» убрано намеренно: рядом с «Месяцем» оно читалось как то же самое,
 * только другими словами, и перегружало ряд.
 */

export const PERIODS = [
  { key: "day", title: "День" },
  { key: "week", title: "Неделя" },
  { key: "month", title: "Месяц" },
  { key: "year", title: "Год" },
  { key: "custom", title: "Свой" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export type Range = { key: PeriodKey; from: string; to: string };

export function rangeFor(key: PeriodKey, today: string, custom?: { from: string; to: string }): Range {
  switch (key) {
    case "day":
      return { key, from: today, to: today };
    case "week":
      return { key, from: shiftDay(today, 6), to: today };
    case "month":
      return { key, from: `${today.slice(0, 7)}-01`, to: today };
    case "year":
      return { key, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return {
        key,
        from: custom?.from ?? shiftDay(today, 29),
        to: custom?.to ?? today,
      };
  }
}

export function rangeTitle(range: Range): string {
  const preset = PERIODS.find((p) => p.key === range.key);
  if (range.key !== "custom") return preset?.title ?? "";
  return `${short(range.from)} — ${short(range.to)}`;
}

function short(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}
