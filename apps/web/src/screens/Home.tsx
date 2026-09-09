import type { State } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";
import { CategoryIcon } from "../icons.js";
import { categoryColor, tint } from "../palette.js";

/**
 * Главный экран.
 *
 * Отвечает на два ежедневных вопроса — сколько потрачено и сколько осталось —
 * и показывает свежие траты. Разбивка по категориям живёт в разборе: она нужна
 * раз в месяц, а лента нужна каждый день.
 */
export function Home({
  state,
  onExpense,
  onCurrency,
}: {
  state: State;
  onExpense: (id: number) => void;
  onCurrency: () => void;
}) {
  const { user, totals, recent, today } = state;
  const budget = user.monthlyBudget;
  const left = budget === null ? null : budget - totals.month;
  const progress = budget === null || budget === 0 ? 0 : Math.min(1, totals.month / budget);
  const dayOfMonth = Number(today.slice(8, 10));
  const perDay = totals.month / Math.max(1, dayOfMonth);

  return (
    <>
      <header className="between" style={{ padding: "10px 2px 20px" }}>
        <p className="label">{monthTitle(today)}</p>
        <button className="pill" onClick={onCurrency}>
          {user.currency}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </header>

      <p className="label" style={{ marginBottom: 8 }}>
        Потрачено
      </p>
      <p className="h1">{money(totals.month, user.currency)}</p>

      {budget !== null && left !== null && (
        <>
          <div className="bar" style={{ margin: "18px 0 10px" }}>
            <i
              style={{
                width: `${Math.round(progress * 100)}%`,
                background: left < 0 ? "var(--rose)" : "var(--mint)",
              }}
            />
          </div>
          <p className="dim" style={{ marginBottom: 18 }}>
            {left >= 0
              ? `осталось ${money(left, user.currency)} из ${money(budget, user.currency)}`
              : `перерасход ${money(-left, user.currency)}`}
          </p>
        </>
      )}

      <div className="stats" style={{ margin: budget === null ? "22px 0 20px" : "0 0 20px" }}>
        <div className="stat">
          <span className="dim">Сегодня</span>
          <b>{money(totals.day, user.currency)}</b>
        </div>
        <div className="stat">
          <span className="dim">В день</span>
          <b>{money(perDay, user.currency)}</b>
        </div>
      </div>

      <p className="label" style={{ margin: "0 2px 10px" }}>
        Последние траты
      </p>

      <div className="card rows" style={{ padding: "2px 16px" }}>
        {recent.length === 0 ? (
          <p className="muted" style={{ padding: "22px 0" }}>
            Трат пока нет. Добавь первую кнопкой ниже или сообщением боту.
          </p>
        ) : (
          recent.slice(0, 12).map((expense, index) => {
            const color = categoryColor(expense.category?.slug, state.categories);
            return (
              <button key={expense.id} className="item" onClick={() => onExpense(expense.id)}>
                <span className="tile" style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}>
                  <CategoryIcon slug={expense.category?.slug} />
                </span>
                <span className="grow">
                  <span className="title">
                    {expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant}
                  </span>
                  <span className="sub">
                    {dayTitle(expense.spentAt, today)}
                    {expense.category === null ? "" : ` · ${expense.category.title}`}
                  </span>
                </span>
                <span className="amount">
                  {moneyExact(expense.amount, expense.currency)}
                  {expense.currency !== user.currency && (
                    <span className="sub" style={{ display: "block" }}>
                      ≈ {money(expense.base, user.currency)}
                    </span>
                  )}
                </span>
                <span hidden>{index}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function monthTitle(today: string): string {
  return MONTHS[Number(today.slice(5, 7)) - 1] ?? "";
}
