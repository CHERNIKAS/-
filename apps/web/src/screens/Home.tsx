import type { Expense, State } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";
import { SwipeRow } from "../SwipeRow.js";
import { PALETTE } from "@costnote/core";
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
  onSwipe,
}: {
  state: State;
  onExpense: (expense: Expense) => void;
  onCurrency: () => void;
  onSwipe: (expense: Expense, reset: () => void) => void;
}) {
  const { user, totals, recent, today } = state;
  const budget = user.monthlyBudget;

  /**
   * Остаток.
   *
   * С лимитом это «сколько ещё можно потратить», без лимита — «сколько
   * осталось от того, что пришло». Второе честнее для тех, кто лимитов не
   * ставит: деньги ведь всё равно кончаются, просто не по плану.
   */
  const left = budget === null ? totals.income - totals.month : budget - totals.month;
  const hasLeft = budget !== null || totals.income > 0;
  const progress = budget === null || budget === 0 ? 0 : Math.min(1, totals.month / budget);
  const dayOfMonth = Number(today.slice(8, 10));

  // Полоска показывается только при нескольких валютах: при одной она
  // повторяла бы сумму месяца и занимала место зря.
  const currencies = state.currencies.filter((c) => c.base > 0);
  const currencyTotal = currencies.reduce((sum, c) => sum + c.base, 0);
  const perDay = totals.month / Math.max(1, dayOfMonth);

  return (
    <>
      <header className="between" style={{ padding: "10px 2px 20px" }}>
        <p className="label">
          {monthTitle(today)}
          {state.sharedActive ? " · общий бюджет" : ""}
        </p>
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

      {currencies.length > 1 && currencyTotal > 0 && (
        <div style={{ margin: "16px 0 0" }}>
          <div style={{ display: "flex", gap: 3 }}>
            {currencies.map((c, i) => (
              <span
                key={c.currency}
                style={{
                  flex: c.base / currencyTotal,
                  height: 6,
                  borderRadius: 99,
                  background: PALETTE[i % PALETTE.length],
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10 }}>
            {currencies.map((c, i) => (
              <span key={c.currency} className="num" style={{ fontSize: 13 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    marginRight: 6,
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
                {moneyExact(c.amount, c.currency)}
              </span>
            ))}
          </div>
        </div>
      )}

      {budget !== null && (
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
        {/* Доход показывается только когда он есть: пустая строка «0» на
            главной у того, кто ведёт одни расходы, — лишний шум. */}
        {totals.income > 0 && (
          <div className="stat">
            <span className="dim">Доход</span>
            <b style={{ color: "var(--mint)" }}>+{money(totals.income, user.currency)}</b>
          </div>
        )}

        {hasLeft && (
          <div className="stat">
            <span className="dim">{budget === null ? "Остаток" : "Осталось"}</span>
            <b style={{ color: left < 0 ? "var(--rose)" : undefined }}>
              {money(left, user.currency)}
            </b>
          </div>
        )}
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
              <SwipeRow key={expense.id} onSwipe={(reset) => onSwipe(expense, reset)}>
              <button className="item" onClick={() => onExpense(expense)}>
                <span
                  className="tile"
                  style={
                    expense.kind === "income"
                      ? { background: "rgba(93,224,180,.16)", color: "var(--mint)", borderColor: "rgba(93,224,180,.28)" }
                      : { background: tint(color), color, borderColor: tint(color, 0.24) }
                  }
                >
                  <CategoryIcon
                    slug={expense.kind === "income" ? "income" : expense.category?.slug}
                    {...(expense.category === null ? {} : { title: expense.category.title })}
                  />
                </span>
                <span className="grow">
                  <span className="title">
                    {expense.merchant === ""
                      ? (expense.incomeSource ?? expense.category?.title ?? "Трата")
                      : expense.merchant}
                  </span>
                  <span className="sub">
                    {dayTitle(expense.spentAt, today)}
                    {expense.kind === "income"
                      ? ` · ${expense.incomeSource ?? "доход"}`
                      : expense.category === null
                        ? ""
                        : ` · ${expense.category.title}`}
                    {/* Возврат виден прямо в строке: иначе сумма в списке и
                        сумма в итогах расходятся без объяснения. */}
                    {expense.refunded > 0 ? ` · вернули ${moneyExact(expense.refunded, expense.currency)}` : ""}
                  </span>
                </span>
                <span
                  className="amount"
                  style={expense.kind === "income" ? { color: "var(--mint)" } : undefined}
                >
                  {expense.kind === "income" ? "+" : ""}
                  {moneyExact(expense.amount, expense.currency)}
                  {expense.currency !== user.currency && (
                    <span className="sub" style={{ display: "block" }}>
                      ≈ {money(expense.base, user.currency)}
                    </span>
                  )}
                </span>
                <span hidden>{index}</span>
              </button>
              </SwipeRow>
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
