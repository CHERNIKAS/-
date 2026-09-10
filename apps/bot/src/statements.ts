import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./env.js";

/**
 * Хранение присланных выписок.
 *
 * Файл сохраняется до разбора и независимо от него: именно нечитаемые выписки
 * и нужны позже больше всего — по ним видно, какой формат бот не понял. Без
 * исходника остаётся только пересказ пользователя, а это не разбор.
 *
 * В базе лежит путь, а не содержимое: PDF на двести килобайт в строке таблицы
 * — способ утопить базу за пару месяцев.
 */

/** Имя, безопасное для файловой системы и узнаваемое человеком. */
function safeName(filename: string): string {
  const clean = filename
    .replace(/[^\p{L}\p{N}.\-_]+/gu, "_")
    .replace(/_+/g, "_")
    .slice(-80);

  return clean === "" ? "statement" : clean;
}

export type StoredStatement = { path: string; size: number };

/**
 * Кладёт файл в папку пользователя под именем со временем получения.
 *
 * Разложено по пользователям: так видно, чьи файлы, и одна папка не
 * превращается в свалку из тысяч имён вида «Виписка.pdf».
 */
export async function storeStatement(
  userId: number,
  filename: string,
  bytes: Uint8Array,
): Promise<StoredStatement | null> {
  try {
    const folder = join(env.STATEMENTS_DIR, String(userId));
    await mkdir(folder, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(folder, `${stamp}_${safeName(filename)}`);

    await writeFile(path, bytes);
    return { path, size: bytes.byteLength };
  } catch (error) {
    // Не сохранилось — не повод отказывать в импорте: файл человек прислал не
    // ради архива, а ради трат.
    console.error("не удалось сохранить выписку:", error);
    return null;
  }
}
