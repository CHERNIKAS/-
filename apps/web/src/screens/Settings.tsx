import { useState } from "react";
import { api, type State } from "../api.js";
import { tap } from "../telegram.js";

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

/** Короткий список: только то, что действительно переключают. */
export function Settings({ state, onChanged }: { state: State; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [budget, setBudget] = useState(
    state.user.monthlyBudget === null ? "" : String(state.user.monthlyBudget),
  );
  const [budgetOn, setBudgetOn] = useState(state.user.monthlyBudget !== null);
  const user = state.user;

  function saveBudget() {
    const value = Number(budget.replace(",", "."));
    const next = budget.trim() === "" || !Number.isFinite(value) || value <= 0 ? null : value;
    if (next === user.monthlyBudget) return;

    void patch({ monthlyBudget: next });
  }

  async function patch(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    tap();
    try {
      await api.settings(body);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="label" style={{ margin: "12px 2px 10px" }}>
        Валюта отображения
      </p>
      <div className="scroller equal" style={{ marginBottom: 12 }}>
        {CURRENCIES.map((c) => (
          <button
            key={c}
            className={c === user.currency ? "pill on" : "pill ghost"}
            onClick={() => void patch({ currency: c })}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="dim" style={{ margin: "0 2px 22px" }}>
        Меняется только показ. Трата навсегда остаётся в той валюте, в которой была.
      </p>

      <div className="card rows" style={{ padding: "2px 16px" }}>
        <div className="item">
          <span className="grow">Напоминание вечером</span>
          <button
            className={user.reminderEnabled ? "pill on" : "pill ghost"}
            onClick={() => void patch({ reminderEnabled: !user.reminderEnabled })}
          >
            {user.reminderEnabled ? `${String(user.reminderHour).padStart(2, "0")}:00` : "выкл"}
          </button>
        </div>

        {user.reminderEnabled && (
          <div className="item">
            <span className="grow muted">
              Час напоминания
            </span>
            <button
              className="pill ghost"
              onClick={() => void patch({ reminderHour: (user.reminderHour + 23) % 24 })}
            >
              −
            </button>
            <button
              className="pill ghost"
              onClick={() => void patch({ reminderHour: (user.reminderHour + 1) % 24 })}
            >
              +
            </button>
          </div>
        )}

        <div className="item">
          <span className="grow">
            Уборка чата
            <span className="sub">
              раз в сутки удаляет вчерашние карточки
            </span>
          </span>
          <button
            className={user.dailyCleanup ? "pill on" : "pill ghost"}
            onClick={() => void patch({ dailyCleanup: !user.dailyCleanup })}
          >
            {user.dailyCleanup ? "вкл" : "выкл"}
          </button>
        </div>

        <div className="item">
          <span className="grow">
            Разбор месяца
            <span className="sub">
              несколько наблюдений первого числа
            </span>
          </span>
          <button
            className={user.monthlyDigest ? "pill on" : "pill ghost"}
            onClick={() => void patch({ monthlyDigest: !user.monthlyDigest })}
          >
            {user.monthlyDigest ? "вкл" : "выкл"}
          </button>
        </div>
      </div>

      {/* Бюджет — не обязанность, а отдельная функция: большинство просто
          смотрит, сколько осталось от поступлений, и лимит им не нужен. */}
      <p className="label" style={{ margin: "24px 2px 10px" }}>
        Месячный бюджет
      </p>
      <div className="card" style={{ padding: "4px 16px" }}>
        <div className="item">
          <span className="grow">
            <span className="title">Лимит на месяц</span>
            <span className="sub">
              {budgetOn ? "покажу, сколько осталось от лимита" : "остаток считается от поступлений"}
            </span>
          </span>
          <button
            className={budgetOn ? "pill on" : "pill ghost"}
            onClick={() => {
              tap();
              if (budgetOn) {
                setBudgetOn(false);
                setBudget("");
                void patch({ monthlyBudget: null });
                return;
              }
              setBudgetOn(true);
            }}
          >
            {budgetOn ? "вкл" : "выкл"}
          </button>
        </div>

        {budgetOn && (
          <div className="item">
            <input
              className="field grow"
              inputMode="decimal"
              autoFocus={user.monthlyBudget === null}
              placeholder="сколько в месяц"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ""))}
              // Сохранение по уходу с поля и по Enter: отдельная кнопка рядом
              // с суммой всё равно нажимается вслепую и только занимает место.
              onBlur={saveBudget}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveBudget();
              }}
            />
          </div>
        )}
      </div>

      <p className="label" style={{ margin: "24px 2px 10px" }}>
        Данные
      </p>

      <button
        className="cta"
        style={{ background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
        onClick={() => {
          tap();
          setExported("Готовлю файл…");
          void api
            .exportCsv()
            .then((r) => setExported(`Отправил в чат: ${r.count} трат`))
            .catch(() => setExported("Не получилось выгрузить"));
        }}
      >
        Выгрузить в CSV
      </button>

      <p className="dim" style={{ margin: "10px 2px 0" }}>
        {exported ?? "Файл придёт сообщением от бота — скачать напрямую из мини-аппа Telegram не даёт."}
      </p>

      <p className="dim" style={{ margin: "24px 2px 8px" }}>
        Часовой пояс: {user.timezone}
      </p>
    </>
  );
}
