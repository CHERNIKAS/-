import { useCallback, useEffect, useState } from "react";
import { api, type Expense, type State } from "./api.js";
import { ExpenseSheet } from "./ExpenseSheet.js";
import { Add } from "./screens/Add.js";
import { Analytics } from "./screens/Analytics.js";
import { History } from "./screens/History.js";
import { Home } from "./screens/Home.js";
import { Settings } from "./screens/Settings.js";
import { IconChart, IconGear, IconHome, IconList, IconPlus } from "./icons.js";
import { notify, tap } from "./telegram.js";

type Tab = "home" | "stats" | "history" | "settings";

const CURRENCIES = [
  { code: "USD", symbol: "$", title: "Доллар" },
  { code: "EUR", symbol: "€", title: "Евро" },
  { code: "UAH", symbol: "₴", title: "Гривна" },
  { code: "TRY", symbol: "₺", title: "Лира" },
] as const;

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузиться");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error !== null) {
    return (
      <div className="err" style={{ marginTop: 40 }}>
        {error}
        <p className="dim" style={{ marginTop: 8 }}>
          Приложение открывается из бота — там оно получает подпись Telegram.
        </p>
      </div>
    );
  }

  if (state === null) return <p className="spinner">Загружаю…</p>;

  return (
    <>
      {tab === "home" && (
        <Home state={state} onExpense={setEditing} onCurrency={() => setPickingCurrency(true)} />
      )}
      {tab === "stats" && <Analytics currency={state.user.currency} today={state.today} />}
      {tab === "history" && (
        <History
          categories={state.categories}
          today={state.today}
          currency={state.user.currency}
          onExpense={setEditing}
        />
      )}
      {tab === "settings" && <Settings state={state} onChanged={() => void reload()} />}

      <nav className="dock">
        {(
          [
            ["home", "Главная", <IconHome key="h" />],
            ["stats", "Разбор", <IconChart key="c" />],
          ] as const
        ).map(([key, title, icon]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              tap();
              setTab(key);
            }}
          >
            {icon}
            {title}
          </button>
        ))}

        <button
          className="add"
          onClick={() => {
            tap("medium");
            setAdding(true);
          }}
        >
          <IconPlus />
        </button>

        {(
          [
            ["history", "История", <IconList key="l" />],
            ["settings", "Ещё", <IconGear key="g" />],
          ] as const
        ).map(([key, title, icon]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              tap();
              setTab(key);
            }}
          >
            {icon}
            {title}
          </button>
        ))}
      </nav>

      {pickingCurrency && (
        <div className="sheet" onClick={() => setPickingCurrency(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <p className="label" style={{ marginBottom: 6 }}>
              Показывать всё в
            </p>
            <p className="dim" style={{ marginBottom: 16 }}>
              Меняется только показ. Трата навсегда остаётся в той валюте, в которой была.
            </p>

            <div className="card rows" style={{ padding: "2px 16px", marginBottom: 16 }}>
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  className="item"
                  onClick={() => {
                    tap();
                    void api
                      .settings({ currency: c.code })
                      .then(() => {
                        setPickingCurrency(false);
                        return reload();
                      })
                      .catch(() => notify("error"));
                  }}
                >
                  <span className="tile">{c.symbol}</span>
                  <span className="grow title">{c.title}</span>
                  {c.code === state.user.currency && <span className="pill on">выбрано</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {adding && (
        <Add
          categories={state.categories}
          currency={state.user.currency}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}

      {editing !== null && (
        <ExpenseSheet
          expense={editing}
          categories={state.categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

    </>
  );
}
