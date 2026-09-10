import { useEffect, useMemo, useState } from "react";
import { api, type Expense } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";
import { PeriodPicker } from "../PeriodPicker.js";
import { type Range, rangeFor, rangeTitle } from "../periods.js";
import { SwipeRow } from "../SwipeRow.js";
import { CategoryIcon, IconSearch } from "../icons.js";
import { categoryColor, tint } from "../palette.js";
import { tap } from "../telegram.js";

const PAYMENT_TITLE: Record<string, string> = {
  card: "Карта",
  cash: "Наличные",
  transfer: "Перевод",
};

/**
 * История.
 *
 * Группировка по дням с дневными итогами и поиск по названию — так находятся
 * вещи, ради которых не стоит заводить категорию: «подарок Ане», «штатив».
 */
export function History({
  focus,
  categories,
  today,
  currency,
  onExpense,
  onSwipe,
}: {
  /** Категория и период, с которыми пришли из разбора. */
  focus: { category: string; range: Range } | null;
  categories: { slug: string; title: string; emoji: string }[];
  today: string;
  currency: string;
  onExpense: (expense: Expense) => void;
  onSwipe: (expense: Expense, reset: () => void) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<Range>(() => rangeFor("month", today));
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Переход из разбора приносит с собой категорию и период — история
  // открывается сразу на том, по чему нажали, а не на своих настройках.
  useEffect(() => {
    if (focus === null) return;
    setCategory(focus.category);
    setRange(focus.range);
  }, [focus]);

  useEffect(() => {
    let alive = true;
    setError(null);

    api
      .expenses(range.from, range.to, {
        ...(category === null ? {} : { category }),
        ...(payment === null ? {} : { payment }),
      })
      .then((result) => {
        if (alive) setExpenses(result.expenses);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не загрузилось");
      });

    return () => {
      alive = false;
    };
  }, [range, category, payment]);

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

  // Итог периода — только расходы и только за вычетом возвратов: доход,
  // попадавший в ту же сумму, делал её больше настоящей траты.
  const total = groups.reduce(
    (sum, [, list]) =>
      sum + list.reduce((s, e) => s + (e.kind === "expense" ? e.netBase : 0), 0),
    0,
  );

  const income = groups.reduce(
    (sum, [, list]) => sum + list.reduce((s, e) => s + (e.kind === "income" ? e.base : 0), 0),
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

      <PeriodPicker today={today} range={range} onChange={setRange} />

      <div className="between" style={{ margin: "14px 0 14px" }}>
        <button
          className={category === null && payment === null ? "pill ghost" : "pill on"}
          onClick={() => {
            // Нажатие по действующему фильтру снимает его: это первое, что
            // пробуешь, когда хочешь вернуться ко всем тратам.
            if (category !== null || payment !== null) {
              tap();
              setCategory(null);
              setPayment(null);
              return;
            }

            setFiltersOpen((open) => !open);
          }}
        >
          {category === null && payment === null
            ? "Фильтры"
            : [
                category === null ? null : categories.find((c) => c.slug === category)?.title,
                payment === null ? null : PAYMENT_TITLE[payment],
              ]
                .filter(Boolean)
                .join(" · ")}
          {(category !== null || payment !== null) && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          )}
        </button>

        <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>
          {money(total, currency)}
          {income > 0 && (
            <span className="sub" style={{ display: "block", color: "var(--mint)" }}>
              +{money(income, currency)}
            </span>
          )}
        </span>
      </div>

      {filtersOpen && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <p className="label" style={{ marginBottom: 8 }}>
            Категория
          </p>
          <div className="chips" style={{ marginBottom: 14 }}>
            <button
              className={category === null ? "pill on" : "pill ghost"}
              onClick={() => setCategory(null)}
            >
              Все
            </button>
            {categories.map((c) => (
              <button
                key={c.slug}
                className={category === c.slug ? "pill on" : "pill ghost"}
                onClick={() => setCategory(c.slug)}
              >
                {c.title}
              </button>
            ))}
          </div>

          <p className="label" style={{ marginBottom: 8 }}>
            Оплата
          </p>
          <div className="chips">
            <button
              className={payment === null ? "pill on" : "pill ghost"}
              onClick={() => setPayment(null)}
            >
              Любая
            </button>
            {Object.entries(PAYMENT_TITLE).map(([key, title]) => (
              <button
                key={key}
                className={payment === key ? "pill on" : "pill ghost"}
                onClick={() => setPayment(key)}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      )}

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
                list.reduce((sum, e) => sum + (e.kind === "expense" ? e.netBase : 0), 0),
                currency,
              )}
            </span>
          </div>

          <div className="card rows" style={{ padding: "2px 16px" }}>
            {list.map((expense) => (
              <SwipeRow key={expense.id} onSwipe={(reset) => onSwipe(expense, reset)}>
              <button className="item" onClick={() => onExpense(expense)}>
                <span
                  className="tile"
                  style={{
                    background: tint(categoryColor(expense.category?.slug, categories)),
                    color: categoryColor(expense.category?.slug, categories),
                    borderColor: tint(categoryColor(expense.category?.slug, categories), 0.24),
                  }}
                >
                  <CategoryIcon
                    slug={expense.kind === "income" ? "income" : expense.category?.slug}
                  />
                </span>
                <span className="grow">
                  <span className="title">
                    {expense.merchant === ""
                      ? (expense.incomeSource ?? expense.category?.title ?? "Трата")
                      : expense.merchant}
                  </span>
                  <span className="sub">
                    {expense.kind === "income"
                      ? (expense.incomeSource ?? "доход")
                      : (expense.category?.title ?? "без категории")}
                    {expense.refunded > 0
                      ? ` · вернули ${moneyExact(expense.refunded, expense.currency)}`
                      : ""}
                  </span>
                </span>
                <span
                  className="amount"
                  style={expense.kind === "income" ? { color: "var(--mint)" } : undefined}
                >
                  {expense.kind === "income" ? "+" : ""}
                  {moneyExact(expense.amount, expense.currency)}
                  {expense.currency !== currency && (
                    <span className="sub" style={{ display: "block" }}>
                      ≈ {money(expense.base, currency)}
                    </span>
                  )}
                </span>
              </button>
              </SwipeRow>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
