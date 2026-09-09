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
  mapping: Mapping;
}): Promise<ImportRecord> {
  const [row] = await db
    .insert(schema.imports)
    .values({
      userId: values.userId,
      ledgerId: values.ledgerId,
      filename: values.filename.slice(0, 255),
      status: "preview",
      payload: JSON.stringify(values.rows),
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

export function importRows(record: ImportRecord): ImportedRow[] {
  if (record.payload === null) return [];
  return JSON.parse(record.payload) as ImportedRow[];
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
