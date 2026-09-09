import { useEffect, useMemo, useState } from "react";
import { api, type Expense } from "../api.js";
import { dayTitle, money, moneyExact, shiftDay } from "../format.js";
import { CategoryIcon, IconSearch } from "../icons.js";
import { categoryColor, tint } from "../palette.js";

/**
 * История.
 *
 * Группировка по дням с дневными итогами и поиск по названию — так находятся
 * вещи, ради которых не стоит заводить категорию: «подарок Ане», «штатив».
 */
export function History({
  categories,
  today,
  currency,
  onExpense,
}: {
  categories: { slug: string; title: string; emoji: string }[];
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
      <div style={{ position: "relative", padding: "10px 0 14px" }}>
        <span style={{ position: "absolute", left: 15, top: 27, color: "var(--ink-3)" }}>
          <IconSearch />
        </span>
        <input
          className="field"
          style={{ paddingLeft: 42 }}
          placeholder="Поиск по тратам"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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
            <span className="label">{dayTitle(day, today)}</span>
            <span className="dim num">
              {money(
                list.reduce((sum, e) => sum + e.base, 0),
                currency,
              )}
            </span>
          </div>

          <div className="card rows" style={{ padding: "2px 16px" }}>
            {list.map((expense) => (
              <button key={expense.id} className="item" onClick={() => onExpense(expense.id)}>
                <span
                  className="tile"
                  style={{
                    background: tint(categoryColor(expense.category?.slug, categories)),
                    color: categoryColor(expense.category?.slug, categories),
                    borderColor: tint(categoryColor(expense.category?.slug, categories), 0.24),
                  }}
                >
                  <CategoryIcon slug={expense.category?.slug} />
                </span>
                <span className="grow">
                  <span className="title">
                    {expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant}
                  </span>
                  <span className="sub">{expense.category?.title ?? "без категории"}</span>
                </span>
                <span className="amount">
                  {moneyExact(expense.amount, expense.currency)}
                  {expense.currency !== currency && (
                    <span className="sub" style={{ display: "block" }}>
                      ≈ {money(expense.base, currency)}
                    </span>
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
