import { useEffect, useMemo, useState } from "react";
import { api, type Expense } from "../api.js";
import { dayTitle, money, moneyExact, shiftDay } from "../format.js";

/**
 * История.
 *
 * Группировка по дням с дневными итогами и поиск по названию — так находятся
 * вещи, ради которых не стоит заводить категорию: «подарок Ане», «штатив».
 */
export function History({
  today,
  currency,
  onExpense,
}: {
  today: string;
  currency: string;
  onExpense: (id: number) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);

    api
      .expenses(shiftDay(today, days), today)
      .then((result) => {
        if (alive) setExpenses(result.expenses);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не загрузилось");
      });

    return () => {
      alive = false;
    };
  }, [today, days]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (expenses ?? []).filter((e) =>
      needle === ""
        ? true
        : `${e.merchant} ${e.note ?? ""} ${e.category?.title ?? ""}`.toLowerCase().includes(needle),
    );

    const byDay = new Map<string, Expense[]>();
    for (const expense of filtered) {
      const list = byDay.get(expense.spentAt) ?? [];
      list.push(expense);
      byDay.set(expense.spentAt, list);
    }

    return [...byDay.entries()];
  }, [expenses, query]);

  const total = groups.reduce(
    (sum, [, list]) => sum + list.reduce((s, e) => s + e.base, 0),
    0,
  );

  return (
    <>
      <input
        className="field"
        placeholder="Поиск по тратам"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="between" style={{ marginBottom: 14 }}>
        <div className="chips">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={d === days ? "pill on" : "pill ghost"}
              onClick={() => setDays(d)}
            >
              {d} дней
            </button>
          ))}
        </div>
        <span className="num muted">{money(total, currency)}</span>
      </div>

      {error !== null && <div className="err">{error}</div>}
      {expenses === null && error === null && <p className="spinner">Загружаю…</p>}

      {groups.length === 0 && expenses !== null && (
        <p className="muted" style={{ padding: "20px 2px" }}>
          Ничего не нашлось
        </p>
      )}

      {groups.map(([day, list]) => (
        <div key={day} style={{ marginBottom: 16 }}>
          <div className="between" style={{ margin: "0 2px 6px" }}>
            <span className="dim">{dayTitle(day, today)}</span>
            <span className="dim num">
              {money(
                list.reduce((sum, e) => sum + e.base, 0),
                currency,
              )}
            </span>
          </div>

          <div className="glass list" style={{ padding: "4px 14px" }}>
            {list.map((expense) => (
              <button key={expense.id} className="item" onClick={() => onExpense(expense.id)}>
                <span className="icon">{expense.category?.emoji ?? "📦"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block" }}>
                    {expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant}
                  </span>
                  <span className="dim">{expense.category?.title ?? "без категории"}</span>
                </span>
                <span className="num" style={{ textAlign: "right" }}>
                  <span style={{ display: "block" }}>
                    {moneyExact(expense.amount, expense.currency)}
                  </span>
                  {expense.currency !== currency && (
                    <span className="dim">≈ {money(expense.base, currency)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
