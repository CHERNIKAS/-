/**
 * Правила «строка → категория» — первый и самый быстрый слой категоризации.
 *
 * Одна правка при вводе создаёт правило, и со следующего раза модель для этой
 * строки не вызывается вообще. Через месяц этот слой закрывает большую часть
 * ввода: отвечает мгновенно, ничего не стоит и не ошибается.
 */

/**
 * Приведение названия к ключу правила.
 *
 * Регистр, лишние пробелы и хвостовая пунктуация роли не играют: "Migros",
 * "migros " и "migros!" — одно и то же место. А вот порядок слов и сами слова
 * оставляем как есть: "корм коту" и "коту корм" человек пишет по-разному
 * редко, а склеивать их эвристикой — верный способ однажды попасть не туда.
 */
export function normalizePattern(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[!?.,;:«»"'()]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export type Rule = { pattern: string; categoryId: number };

/**
 * Поиск правила под название траты.
 *
 * Сначала точное совпадение целиком — оно надёжнее всего. Если его нет,
 * пробуем самое длинное правило, которое целиком входит в название отдельными
 * словами: правило "migros" сработает на "migros на углу", но не на
 * "migroskop". Длинное правило выигрывает у короткого, потому что оно
 * конкретнее.
 */
export function findRule(merchant: string, rules: Rule[]): Rule | null {
  const key = normalizePattern(merchant);
  if (key === "") return null;

  const exact = rules.find((r) => r.pattern === key);
  if (exact) return exact;

  const contained = rules
    .filter((r) => r.pattern !== "" && containsAsWords(key, r.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length);

  return contained[0] ?? null;
}

function containsAsWords(haystack: string, needle: string): boolean {
  const words = haystack.split(" ");
  const target = needle.split(" ");
  if (target.length > words.length) return false;

  for (let i = 0; i + target.length <= words.length; i++) {
    let hit = true;
    for (let j = 0; j < target.length; j++) {
      if (words[i + j] !== target[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}
