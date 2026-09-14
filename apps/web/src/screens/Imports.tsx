import { plural } from "../format.js";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Confirm } from "../Confirm.js";
import { notify, tap } from "../telegram.js";

type Row = Awaited<ReturnType<typeof api.imports>>["imports"][number];

/**
 * Загруженные выписки.
 *
 * Отменить импорт раньше можно было только кнопкой под сообщением в чате, а оно
 * тонет за день. Здесь каждая выписка видна целиком: сколько трат, доходов и
 * переносов она принесла — ровно столько и уйдёт при удалении.
 */
export function Imports({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRows((await api.imports()).imports);
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Не загрузилось"));
  }, []);

  return (
    <>
      <p className="label" style={{ margin: "12px 2px 6px" }}>
        Выписки
      </p>
      <p className="dim" style={{ margin: "0 2px 14px" }}>
        Удаление убирает все операции из файла. Остальные траты не трогаются.
      </p>

      {error !== null && <div className="err">{error}</div>}
      {rows === null && error === null && <p className="spinner">Загружаю…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <p className="muted">Выписок пока нет. Пришли файл боту — CSV, XLSX или PDF.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="card rows" style={{ padding: "2px 16px" }}>
          {rows.map((row) => (
            <div key={row.id} className="item">
              <span className="grow">
                <span className="title" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.filename}
                </span>
                <span className="sub">{describe(row)}</span>
              </span>
              <button
                className="danger-square"
                aria-label={`Удалить ${row.filename}`}
                onClick={() => {
                  tap();
                  setPending(row);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 12.5h9L17.5 7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {pending !== null && (
        <Confirm
          title="Удалить выписку?"
          detail={`${pending.filename} · ${describe(pending)}`}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await api.removeImport(pending.id);
            notify("success");
            setPending(null);
            await load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** Что именно лежит в файле: удаляя, человек должен видеть, что теряет. */
function describe(row: Row): string {
  const parts = [row.createdAt];
  if (row.expenses > 0) parts.push(plural(row.expenses, "трата", "траты", "трат"));
  if (row.incomes > 0) parts.push(plural(row.incomes, "доход", "дохода", "доходов"));
  if (row.transfers > 0) parts.push(plural(row.transfers, "перенос", "переноса", "переносов"));
  if (row.total === 0) parts.push("операций не осталось");
  return parts.join(" · ");
}
