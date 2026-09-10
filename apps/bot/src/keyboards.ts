import { InlineKeyboard, Keyboard } from "grammy";
import type { Category } from "@costnote/core/data";

/**
 * Реплай-клавиатура: быстрые действия.
 *
 * Без persistent — именно этот флаг заставляет Telegram держать клавиатуру
 * всегда и прячет штатную кнопку сворачивания справа от поля ввода. Без него
 * кнопка появляется и клавиатуру можно убрать одним нажатием.
 */
export const mainKeyboard = new Keyboard()
  .text("Аналитика")
  .text("Помощь")
  .resized();

export const CARD_ACTIONS = {
  edit: (id: number) => `x:edit:${id}`,
  del: (id: number) => `x:del:${id}`,
  delYes: (id: number) => `x:delyes:${id}`,
  back: (id: number) => `x:back:${id}`,
  pick: (id: number, slug: string) => `x:pick:${id}:${slug}`,
  page: (id: number, page: number) => `x:page:${id}:${page}`,
  all: (id: number) => `x:all:${id}`,
};

export function cardKeyboard(expenseId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Редактировать", CARD_ACTIONS.edit(expenseId))
    .text("Отменить", CARD_ACTIONS.del(expenseId));
}

export function deleteKeyboard(expenseId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да, удалить", CARD_ACTIONS.delYes(expenseId))
    .text("Оставить", CARD_ACTIONS.back(expenseId));
}

/**
 * Быстрый выбор: пять самых частых категорий и кнопка ко всему списку.
 *
 * Пятьдесят категорий на экран не влезут и не должны: почти всегда нужная
 * лежит среди частых, а остальное — через список со страницами.
 */
export function quickPickKeyboard(
  expenseId: number,
  frequent: Category[],
  currentSlug: string | null,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  frequent.slice(0, 5).forEach((c, i) => {
    const mark = c.slug === currentSlug ? " ✓" : "";
    kb.text(`${c.emoji} ${c.title}${mark}`, CARD_ACTIONS.pick(expenseId, c.slug));
    if (i % 2 === 1) kb.row();
  });

  kb.row().text("Все категории", CARD_ACTIONS.all(expenseId));
  kb.row().text("← Назад", CARD_ACTIONS.back(expenseId));
  return kb;
}

export const PAGE_SIZE = 10;

/** Страницы по десять в две колонки, снизу навигация. Всё в том же сообщении. */
export function categoryPageKeyboard(
  expenseId: number,
  categories: Category[],
  page: number,
  currentSlug: string | null,
): InlineKeyboard {
  const pages = Math.max(1, Math.ceil(categories.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = categories.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const kb = new InlineKeyboard();
  slice.forEach((c, i) => {
    const mark = c.slug === currentSlug ? " ✓" : "";
    kb.text(`${c.emoji} ${c.title}${mark}`, CARD_ACTIONS.pick(expenseId, c.slug));
    if (i % 2 === 1) kb.row();
  });

  if (slice.length % 2 === 1) kb.row();

  if (pages > 1) {
    kb.text("‹", CARD_ACTIONS.page(expenseId, safePage === 0 ? pages - 1 : safePage - 1))
      .text(`${safePage + 1} / ${pages}`, "x:noop")
      .text("›", CARD_ACTIONS.page(expenseId, safePage === pages - 1 ? 0 : safePage + 1))
      .row();
  }

  kb.text("← Назад", CARD_ACTIONS.back(expenseId));
  return kb;
}
