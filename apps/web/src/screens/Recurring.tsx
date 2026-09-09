import { useEffect, useState } from "react";
import { api, type Category, type RecurringItem } from "../api.js";
import { moneyExact } from "../format.js";
import { CategorySheet } from "../CategorySheet.js";
import { notify, tap } from "../telegram.js";

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

/**
 * Регулярные платежи.
 *
 * Заводятся один раз и начисляются сами утром нужного числа. Это те траты,
 * которые человек помнит хуже всего: за ними нет похода в магазин, и именно
 * они тихо съедают бюджет.
 */
export function Recurring({
  categories,
  currency: defaultCurrency,
  onChanged,
}: {
  categories: Category[];
  currency: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [day, setDay] = useState("1");
  const [slug, setSlug] = useState<string | null>(null);

  async function load() {
    setItems((await api.recurring()).items);
  }

  useEffect(() => {
    void load().catch(() => notify("error"));
  }, []);

  const parsed = Number(amount.replace(",", "."));
  const canSave = title.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  async function create() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      await api.createRecurring({
        title: title.trim(),
        amount: parsed,
        currency,
        dayOfMonth: Math.min(28, Math.max(1, Number(day) || 1)),
        ...(slug === null ? {} : { categorySlug: slug }),
      });
      setAdding(false);
      setTitle("");
      setAmount("");
      setSlug(null);
      await load();
      onChanged();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <CategorySheet
        categories={categories}
        current={slug}
        onClose={() => setPicking(false)}
        onPick={(picked) => {
          setSlug(picked);
          setPicking(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="between" style={{ padding: "12px 2px 14px" }}>
        <p className="label">Регулярные платежи</p>
        <span className="dim">{items.filter((i) => i.active).length} активных</span>
      </div>

      <div className="card rows" style={{ padding: "2px 16px", marginBottom: 16 }}>
        {items.length === 0 && (
          <p className="muted" style={{ padding: "20px 0" }}>
            Подписки, аренда, счета. Заведёшь один раз — дальше начисляются сами.
          </p>
        )}

        {items.map((item) => (
          <div key={item.id} className="item">
            <span className="grow">
              <span className="title" style={{ opacity: item.active ? 1 : 0.5 }}>
                {item.title}
              </span>
              <span className="sub">
                {item.dayOfMonth} числа
                {item.category === null ? "" : ` · ${item.category}`}
              </span>
            </span>
            <span className="amount" style={{ opacity: item.active ? 1 : 0.5 }}>
              {moneyExact(item.amount, item.currency)}
            </span>
            <button
              className={item.active ? "pill" : "pill ghost"}
              onClick={() => {
                tap();
                void api
                  .toggleRecurring(item.id, !item.active)
                  .then(load)
                  .catch(() => notify("error"));
              }}
            >
              {item.active ? "вкл" : "выкл"}
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ marginBottom: 10 }}>
            Новый платёж
          </p>

          <input
            className="field"
            placeholder="Spotify, аренда, интернет"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          <div className="row" style={{ marginBottom: 10 }}>
            <input
              className="field"
              inputMode="decimal"
              placeholder="сумма"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            />
            <div className="chips">
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  className={code === currency ? "pill on" : "pill ghost"}
                  onClick={() => setCurrency(code)}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="dim" style={{ flex: 1 }}>
              Какого числа
            </span>
            <input
              className="field"
              inputMode="numeric"
              style={{ width: 90, textAlign: "center" }}
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </div>
          <p className="dim" style={{ margin: "0 2px 12px" }}>
            До 28-го: 29–31 есть не в каждом месяце.
          </p>

          <button
            className="field row"
            style={{ marginBottom: 14, textAlign: "left" }}
            onClick={() => setPicking(true)}
          >
            <span className="grow">
              {categories.find((c) => c.slug === slug)?.title ?? "Выбрать категорию"}
            </span>
          </button>

          <button className="cta mint" disabled={!canSave || busy} onClick={() => void create()}>
            Завести
          </button>
          <button
            className="cta"
            style={{ marginTop: 10, background: "rgba(255,255,255,.1)", color: "var(--ink)" }}
            onClick={() => setAdding(false)}
          >
            Отмена
          </button>
        </div>
      ) : (
        <button
          className="cta"
          style={{ background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
          onClick={() => {
            tap();
            setAdding(true);
          }}
        >
          Добавить платёж
        </button>
      )}
    </>
  );
}
