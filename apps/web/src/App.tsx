import { useCallback, useEffect, useState } from "react";
import { api, type Expense, type State } from "./api.js";
import { moneyExact } from "./format.js";
import { Confirm } from "./Confirm.js";
import { ExpenseSheet } from "./ExpenseSheet.js";
import { Add } from "./screens/Add.js";
import { Analytics } from "./screens/Analytics.js";
import { Categories } from "./screens/Categories.js";
import { History } from "./screens/History.js";
import { Home } from "./screens/Home.js";
import { Recurring } from "./screens/Recurring.js";
import { Settings } from "./screens/Settings.js";
import { Shared } from "./screens/Shared.js";
import { IconChart, IconGear, IconHome, IconList, IconPlus } from "./icons.js";
import { backButton, notify, tap } from "./telegram.js";
import type { Range } from "./periods.js";
import { useBodyLock } from "./useBodyLock.js";
import { useViewport } from "./useViewport.js";
import { useSheetDrag } from "./useSheetDrag.js";

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
  const [more, setMore] = useState<"settings" | "categories" | "recurring" | "shared">("settings");
  /**
   * Куда смотреть истории при переходе из разбора.
   *
   * Кольцо отвечает «сколько», а следующий вопрос всегда «на что именно» —
   * и ответ на него уже есть в истории, надо только донести туда категорию и
   * тот же период.
   */
  const [focus, setFocus] = useState<{ category: string; range: Range } | null>(null);

  /**
   * Пришли ли в историю из разбора.
   *
   * Отдельно от самого перехода: фильтр применяется один раз и дальше живёт
   * своей жизнью — его можно снять, — а кнопка «назад» должна оставаться,
   * пока человек не ушёл из истории сам.
   */
  const [fromStats, setFromStats] = useState(false);

  /**
   * Штатная кнопка «назад» в шапке Telegram.
   *
   * Провалившись из разбора в категорию, человек оказывается в истории с
   * чужим фильтром, и выйти оттуда было нечем: снизу вкладки, сверху ничего.
   */
  useEffect(() => {
    if (!fromStats || tab !== "history") return;

    return backButton(true, () => {
      setFromStats(false);
      setTab("stats");
    });
  }, [fromStats, tab]);

  const clearFocus = useCallback(() => setFocus(null), []);

  // Клавиатура меняет видимую высоту, и шторки должны мериться по ней.
  useViewport();

  const closeCurrency = useCallback(() => setPickingCurrency(false), []);
  const currencyDrag = useSheetDrag(closeCurrency);
  useBodyLock(pickingCurrency);

  // Смахнутая строка ждёт подтверждения: reset вернёт её на место при отказе.
  const [pending, setPending] = useState<{
    title: string;
    detail?: string;
    action: () => Promise<void>;
    reset: () => void;
  } | null>(null);

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
        <Home
          state={state}
          onExpense={setEditing}
          onCurrency={() => setPickingCurrency(true)}
          onSwipe={(expense, reset) =>
            setPending({
              title: "Удалить трату?",
              detail: `${expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant} · ${moneyExact(expense.amount, expense.currency)}`,
              action: async () => {
                await api.remove(expense.id);
                notify("success");
                await reload();
              },
              reset,
            })
          }
        />
      )}
      {tab === "stats" && (
        <Analytics
          currency={state.user.currency}
          today={state.today}
          onCategory={(category, range) => {
            setFocus({ category, range });
            setFromStats(true);
            setTab("history");
          }}
        />
      )}
      {tab === "history" && (
        <History
          focus={focus}
          onFocusApplied={clearFocus}
          categories={state.categories}
          today={state.today}
          currency={state.user.currency}
          onExpense={setEditing}
          onSwipe={(expense, reset) =>
            setPending({
              title: "Удалить трату?",
              detail: `${expense.merchant === "" ? (expense.category?.title ?? "Трата") : expense.merchant} · ${moneyExact(expense.amount, expense.currency)}`,
              action: async () => {
                await api.remove(expense.id);
                notify("success");
                await reload();
              },
              reset,
            })
          }
        />
      )}
      {tab === "settings" && (
        <>
          <div className="scroller equal" style={{ padding: "12px 0 18px" }}>
            {(
              [
                ["settings", "Основное"],
                ["categories", "Категории"],
                ["recurring", "Регулярные"],
                ["shared", "Общий"],
              ] as const
            ).map(([key, title]) => (
              <button
                key={key}
                className={more === key ? "pill on" : "pill ghost"}
                onClick={() => {
                  tap();
                  setMore(key);
                }}
              >
                {title}
              </button>
            ))}
          </div>

          {more === "settings" && <Settings state={state} onChanged={() => void reload()} />}
          {more === "categories" && (
            <Categories
              currency={state.user.currency}
              incomeSources={state.user.incomeSources}
              onChanged={() => void reload()}
            />
          )}
          {more === "recurring" && (
            <Recurring
              categories={state.categories}
              currency={state.user.currency}
              onChanged={() => void reload()}
            />
          )}
          {more === "shared" && (
            <Shared
              onChanged={() => void reload()}
              onRemoveMember={(member, reset) =>
                setPending({
                  title: "Убрать из общего бюджета?",
                  detail: member.name,
                  action: async () => {
                    await api.removeMember(member.userId);
                    notify("success");
                    await reload();
                  },
                  reset,
                })
              }
            />
          )}
        </>
      )}

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
              setFromStats(false);
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
              if (key !== "history") setFromStats(false);
              setTab(key);
            }}
          >
            {icon}
            {title}
          </button>
        ))}
      </nav>

      {pickingCurrency && (
        <div className="sheet short" onClick={closeCurrency}>
          <div
            ref={currencyDrag.ref}
            onClick={(e) => e.stopPropagation()}
            style={currencyDrag.sheetStyle}
          >
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
          incomeSources={state.user.incomeSources}
          currency={state.user.currency}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}

      {pending !== null && (
        <Confirm
          title={pending.title}
          {...(pending.detail === undefined ? {} : { detail: pending.detail })}
          onConfirm={async () => {
            await pending.action();
            setPending(null);
          }}
          onCancel={() => {
            pending.reset();
            setPending(null);
          }}
        />
      )}

      {editing !== null && (
        <ExpenseSheet
          expense={editing}
          categories={state.categories}
          incomeSources={state.user.incomeSources}
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
