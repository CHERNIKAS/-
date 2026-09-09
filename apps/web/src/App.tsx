import { useCallback, useEffect, useState } from "react";
import { api, type State } from "./api.js";
import { moneyExact } from "./format.js";
import { Add } from "./screens/Add.js";
import { Analytics } from "./screens/Analytics.js";
import { History } from "./screens/History.js";
import { Home } from "./screens/Home.js";
import { Settings } from "./screens/Settings.js";
import { notify, tap } from "./telegram.js";

type Tab = "home" | "stats" | "history" | "settings";

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

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

  const expense = state.recent.find((e) => e.id === editing) ?? null;

  return (
    <>
      {tab === "home" && <Home state={state} onExpense={setEditing} />}
      {tab === "stats" && <Analytics currency={state.user.currency} />}
      {tab === "history" && (
        <History today={state.today} currency={state.user.currency} onExpense={setEditing} />
      )}
      {tab === "settings" && <Settings state={state} onChanged={() => void reload()} />}

      <nav className="dock">
        <button
          className={tab === "home" ? "active" : ""}
          onClick={() => {
            tap();
            setTab("home");
          }}
        >
          <span>🏠</span>
          Главная
        </button>
        <button
          className={tab === "stats" ? "active" : ""}
          onClick={() => {
            tap();
            setTab("stats");
          }}
        >
          <span>📊</span>
          Разбор
        </button>
        <button
          className="add"
          onClick={() => {
            tap("medium");
            setAdding(true);
          }}
        >
          <span style={{ fontSize: 18 }}>＋</span>
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => {
            tap();
            setTab("history");
          }}
        >
          <span>🧾</span>
          История
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => {
            tap();
            setTab("settings");
          }}
        >
          <span>⚙️</span>
          Ещё
        </button>
      </nav>

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

      {expense !== null && (
        <div className="sheet" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <p className="dim">{expense.merchant === "" ? "Трата" : expense.merchant}</p>
            <p className="amount" style={{ marginTop: 4 }}>
              {moneyExact(expense.amount, expense.currency)}
            </p>

            <p className="dim" style={{ margin: "18px 2px 8px" }}>
              Категория
            </p>
            <div className="chips" style={{ marginBottom: 20 }}>
              {state.categories.map((c) => (
                <button
                  key={c.slug}
                  className={c.slug === expense.category?.slug ? "pill on" : "pill ghost"}
                  onClick={() => {
                    tap();
                    void api
                      .update(expense.id, { categorySlug: c.slug })
                      .then(() => {
                        setEditing(null);
                        return reload();
                      })
                      .catch(() => notify("error"));
                  }}
                >
                  {c.emoji} {c.title}
                </button>
              ))}
            </div>

            <button
              className="cta"
              style={{ background: "rgba(255,120,120,.18)", color: "#ffb4b4" }}
              onClick={() => {
                void api
                  .remove(expense.id)
                  .then(() => {
                    notify("success");
                    setEditing(null);
                    return reload();
                  })
                  .catch(() => notify("error"));
              }}
            >
              Удалить трату
            </button>
          </div>
        </div>
      )}
    </>
  );
}
