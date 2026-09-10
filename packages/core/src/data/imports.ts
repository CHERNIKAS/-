import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ImportedRow } from "../import/apply.js";
import type { Mapping } from "../import/detect.js";
import { db, schema } from "./db.js";

/**
 * Импорт выписки.
 *
 * Разбор и применение разнесены: файл сначала превращается в предпросмотр, и
 * только после подтверждения строки становятся тратами. Иначе неверно понятый
 * формат молча засоряет историю сотнями записей.
 */

export type ImportRecord = typeof schema.imports.$inferSelect;

export async function createImportPreview(values: {
  userId: number;
  ledgerId: number;
  filename: string;
  rows: ImportedRow[];
  /** Приходы из того же файла: после подтверждения по ним ищутся возвраты. */
  credits: ImportedRow[];
  mapping: Mapping;
}): Promise<ImportRecord> {
  const [row] = await db
    .insert(schema.imports)
    .values({
      userId: values.userId,
      ledgerId: values.ledgerId,
      filename: values.filename.slice(0, 255),
      status: "preview",
      payload: JSON.stringify({ rows: values.rows, credits: values.credits }),
      mapping: JSON.stringify(values.mapping),
      rowCount: values.rows.length,
    })
    .returning();

  if (!row) throw new Error("не удалось сохранить предпросмотр импорта");
  return row;
}

export async function importById(id: number): Promise<ImportRecord | undefined> {
  return db.query.imports.findFirst({ where: eq(schema.imports.id, id) });
}

/**
 * Старые предпросмотры хранили просто массив строк, новые — строки и приходы
 * вместе. Читаются оба вида: незаконченный импорт не должен ломаться от
 * выкатки.
 */
function payload(record: ImportRecord): { rows: ImportedRow[]; credits: ImportedRow[] } {
  if (record.payload === null) return { rows: [], credits: [] };

  const parsed = JSON.parse(record.payload) as ImportedRow[] | { rows?: ImportedRow[]; credits?: ImportedRow[] };
  if (Array.isArray(parsed)) return { rows: parsed, credits: [] };

  return { rows: parsed.rows ?? [], credits: parsed.credits ?? [] };
}

export function importRows(record: ImportRecord): ImportedRow[] {
  return payload(record).rows;
}

export function importCredits(record: ImportRecord): ImportedRow[] {
  return payload(record).credits;
}

/** Строки, которые уже есть в книге: повторный импорт их пропустит. */
export async function existingFingerprints(
  ledgerId: number,
  fingerprints: string[],
): Promise<Set<string>> {
  if (fingerprints.length === 0) return new Set();

  const rows = await db
    .select({ fingerprint: schema.expenses.fingerprint })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.ledgerId, ledgerId),
        isNull(schema.expenses.deletedAt),
        inArray(schema.expenses.fingerprint, fingerprints),
      ),
    );

  return new Set(rows.map((r) => r.fingerprint).filter((f): f is string => f !== null));
}

export async function markImportApplied(id: number, count: number): Promise<void> {
  await db
    .update(schema.imports)
    .set({ status: "applied", appliedAt: new Date(), rowCount: count, payload: null })
    .where(eq(schema.imports.id, id));
}

export async function cancelImport(id: number): Promise<void> {
  await db
    .update(schema.imports)
    .set({ status: "cancelled", payload: null })
    .where(eq(schema.imports.id, id));
}

/** Откат: траты импорта помечаются удалёнными, сам импорт — отменённым. */
export async function undoImport(id: number): Promise<number> {
  const affected = await db
    .update(schema.expenses)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.expenses.importId, id), isNull(schema.expenses.deletedAt)))
    .returning({ id: schema.expenses.id });

  await cancelImport(id);
  return affected.length;
}
