import { PALETTE } from "@costnote/core";
import type { Category } from "./api.js";

/**
 * Цвет категории.
 *
 * Считается по её месту в списке, а не по хэшу названия: так цвет у категории
 * один и тот же на всех экранах и совпадает с сегментом кольца.
 */
export function categoryColor(slug: string | undefined, categories: Category[]): string {
  if (slug === undefined) return PALETTE[PALETTE.length - 1] as string;
  const index = categories.findIndex((c) => c.slug === slug);
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length] as string;
}

/** Тот же цвет, но полупрозрачный — для плиток под иконками. */
export function tint(color: string, alpha = 0.16): string {
  const value = color.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
