import { useState } from "react";
import { api, type State } from "../api.js";
import { tap } from "../telegram.js";

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

/** Короткий список: только то, что действительно переключают. */
export function Settings({ state, onChanged }: { state: State; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(
    state.user.monthlyBudget === null ? "" : String(state.user.monthlyBudget),
  );
  const user = state.user;

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
      <p className="dim" style={{ margin: "0 2px 8px" }}>
        Валюта отображения
      </p>
      <div className="chips" style={{ marginBottom: 20 }}>
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
      <p className="dim" style={{ margin: "-14px 2px 20px" }}>
        Меняется только показ. Трата навсегда остаётся в той валюте, в которой была.
      </p>

      <div className="glass list" style={{ padding: "4px 14px" }}>
        <div className="item">
          <span style={{ flex: 1 }}>Напоминание вечером</span>
          <button
            className={user.reminderEnabled ? "pill on" : "pill ghost"}
            onClick={() => void patch({ reminderEnabled: !user.reminderEnabled })}
          >
            {user.reminderEnabled ? `${String(user.reminderHour).padStart(2, "0")}:00` : "выкл"}
          </button>
        </div>

        {user.reminderEnabled && (
          <div className="item">
            <span style={{ flex: 1 }} className="muted">
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
          <span style={{ flex: 1 }}>
            Уборка чата
            <span className="dim" style={{ display: "block" }}>
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
          <span style={{ flex: 1 }}>
            Разбор месяца
            <span className="dim" style={{ display: "block" }}>
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

      <p className="dim" style={{ margin: "20px 2px 8px" }}>
        Месячный бюджет
      </p>
      <div className="row">
        <input
          className="field"
          inputMode="decimal"
          placeholder="не задан"
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ""))}
        />
        <button
          className="pill"
          style={{ padding: "14px 18px" }}
          onClick={() => {
            const value = Number(budget.replace(",", "."));
            void patch({ monthlyBudget: budget.trim() === "" ? null : value });
          }}
        >
          Сохранить
        </button>
      </div>

      <p className="dim" style={{ margin: "20px 2px 0" }}>
        Часовой пояс: {user.timezone}
      </p>
    </>
  );
}
