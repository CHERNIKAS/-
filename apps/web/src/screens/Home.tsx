import type { State } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";

/**
 * Главный экран.
 *
 * Отвечает на два ежедневных вопроса — сколько потрачено и сколько осталось —
 * и показывает свежие траты. Разбивка по категориям живёт в аналитике: она
 * нужна раз в месяц, а лента нужна каждый день.
 */
export function Home({ state, onExpense }: { state: State; onExpense: (id: number) => void }) {
  const { user, totals, recent, today } = state;
  const budget = user.monthlyBudget;
  const left = budget === null ? null : budget - totals.month;
  const progress = budget === null || budget === 0 ? 0 : Math.min(1, totals.month / budget);

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <span className="muted">{monthTitle(today)}</span>
        <span className="pill">{user.currency}</span>
      </div>

      <p className="dim">Потрачено</p>
      <p className="amount">{money(totals.month, user.currency)}</p>

      {left === null || budget === null ? (
        <p className="muted" style={{ marginTop: 8 }}>
          сегодня {money(totals.day, user.currency)}
        </p>
      ) : (
        <>
          <p style={{ margin: "10px 0 0" }}>
            <span
              className="pill"
              style={{
                background: left >= 0 ? "rgba(93,224,180,.14)" : "rgba(255,120,120,.16)",
                borderColor: left >= 0 ? "rgba(93,224,180,.32)" : "rgba(255,120,120,.32)",
                color: left >= 0 ? "#5DE0B4" : "#ff9a9a",
              }}
            >
              {left >= 0
                ? `осталось ${money(left, user.currency)} из ${money(budget, user.currency)}`
                : `перерасход ${money(-left, user.currency)}`}
            </span>
          </p>
          <div
            style={{
              height: 5,
              borderRadius: 99,
              background: "rgba(0,0,0,.25)",
              overflow: "hidden",
              margin: "14px 0 4px",
            }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                background: left !== null && left < 0 ? "#ff9a9a" : "#5DE0B4",
              }}
            />
          </div>
          <p className="dim">сегодня {money(totals.day, user.currency)}</p>
        </>
      )}

      <div className="glass list" style={{ padding: "4px 14px", marginTop: 20 }}>
        {recent.length === 0 ? (
          <p className="muted" style={{ padding: "16px 0" }}>
            Трат пока нет. Добавь первую — кнопкой ниже или сообщением боту.
          </p>
        ) : (
          recent.slice(0, 12).map((expense) => (
            <button key={expense.id} className="item" onClick={() => onExpense(expense.id)}>
              <span className="icon">{expense.category?.emoji ?? "📦"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block" }}>
                  {expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant}
                </span>
                <span className="dim">
                  {dayTitle(expense.spentAt, today)}
                  {expense.category === null ? "" : ` · ${expense.category.title}`}
                </span>
              </span>
              <span className="num" style={{ textAlign: "right" }}>
                <span style={{ display: "block" }}>
                  {moneyExact(expense.amount, expense.currency)}
                </span>
                {expense.currency !== user.currency && (
                  <span className="dim">≈ {money(expense.base, user.currency)}</span>
                )}
              </span>
            </button>
          ))
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
