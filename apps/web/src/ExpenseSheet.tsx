import { useState } from "react";
import { api, type Category, type Expense } from "./api.js";
import { CategorySheet } from "./CategorySheet.js";
import { moneyExact } from "./format.js";
import { CategoryIcon } from "./icons.js";
import { categoryColor, tint } from "./palette.js";
import { notify, tap } from "./telegram.js";
import { useSheetDrag } from "./useSheetDrag.js";
import { useBodyLock } from "./useBodyLock.js";

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

const PAYMENTS = [
  { key: "card", title: "Карта" },
  { key: "cash", title: "Наличные" },
  { key: "transfer", title: "Перевод" },
] as const;

/**
 * Карточка траты.
 *
 * Всё, что о ней известно, и всё редактируемо — включая то, что подставила
 * модель. Правка категории здесь учит систему так же, как правка в боте:
 * сервер создаёт правило, и следующая такая же строка разберётся мгновенно.
 */
export function ExpenseSheet({
  expense,
  categories,
  onSaved,
  onClose,
}: {
  expense: Expense;
  categories: Category[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(expense.amount.toFixed(2).replace(".", ","));
  const [currency, setCurrency] = useState(expense.currency);
  const [spentAt, setSpentAt] = useState(expense.spentAt);
  const [payment, setPayment] = useState(expense.payment);
  const [merchant, setMerchant] = useState(expense.merchant);
  const [note, setNote] = useState(expense.note ?? "");
  const [slug, setSlug] = useState(expense.category?.slug ?? null);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBodyLock(true);
  const drag = useSheetDrag(onClose);

  const category = categories.find((c) => c.slug === slug) ?? null;
  const color = categoryColor(slug ?? undefined, categories);
  const parsedAmount = Number(amount.replace(",", "."));
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0;

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      await api.update(expense.id, {
        amount: parsedAmount,
        currency,
        spentAt,
        payment,
        merchant,
        note: note.trim() === "" ? null : note.trim(),
        ...(slug === null ? {} : { categorySlug: slug }),
      });
      notify("success");
      onSaved();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.remove(expense.id);
      notify("success");
      onSaved();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не получилось удалить");
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
    <div className="sheet" onClick={onClose}>
      <div
        ref={drag.ref}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", ...drag.sheetStyle }}
      >
        <div className="grabber" />

        <button
          onClick={onClose}
          aria-label="Закрыть"
          style={{
            position: "absolute",
            right: 16,
            top: 14,
            width: 32,
            height: 32,
            borderRadius: 999,
            background: "rgba(255,255,255,.12)",
            display: "grid",
            placeItems: "center",
            fontSize: 16,
            lineHeight: 1,
            color: "var(--ink-2)",
          }}
        >
          ✕
        </button>


        {error !== null && (
          <div className="err" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div className="row" style={{ marginBottom: 18 }}>
          <span
            className="tile"
            style={{
              width: 44,
              height: 44,
              background: tint(color),
              color,
              borderColor: tint(color, 0.24),
            }}
          >
            <CategoryIcon slug={slug ?? undefined} size={22} />
          </span>
          <span className="grow">
            <span className="title" style={{ fontSize: 17 }}>
              {merchant === "" ? (category?.title ?? "Трата") : merchant}
            </span>
            <span className="sub">{provenance(expense)}</span>
          </span>
        </div>

        <p className="label" style={{ marginBottom: 8 }}>
          Сумма
        </p>
        <div className="row" style={{ marginBottom: 18 }}>
          <input
            className="field"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          />
          <div className="chips">
            {CURRENCIES.map((code) => (
              <button
                key={code}
                className={code === currency ? "pill on" : "pill ghost"}
                onClick={() => {
                  tap();
                  setCurrency(code);
                }}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <p className="label" style={{ marginBottom: 8 }}>
          Категория
        </p>
        <button
          className="field row"
          style={{ marginBottom: 18, textAlign: "left" }}
          onClick={() => {
            tap();
            setPicking(true);
          }}
        >
          <span className="grow">{category?.title ?? "Выбрать категорию"}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>

        <p className="label" style={{ marginBottom: 8 }}>
          Дата
        </p>
        <input
          className="field"
          type="date"
          value={spentAt}
          onChange={(e) => setSpentAt(e.target.value)}
          style={{ marginBottom: 18 }}
        />

        <p className="label" style={{ marginBottom: 8 }}>
          Оплата
        </p>
        <div className="chips" style={{ marginBottom: 18 }}>
          {PAYMENTS.map((p) => (
            <button
              key={p.key}
              className={p.key === payment ? "pill on" : "pill ghost"}
              onClick={() => {
                tap();
                setPayment(p.key);
              }}
            >
              {p.title}
            </button>
          ))}
        </div>

        <p className="label" style={{ marginBottom: 8 }}>
          Название
        </p>
        <input
          className="field"
          value={merchant}
          placeholder="где потратил"
          onChange={(e) => setMerchant(e.target.value)}
          style={{ marginBottom: 18 }}
        />

        <p className="label" style={{ marginBottom: 8 }}>
          Заметка
        </p>
        <input
          className="field"
          value={note}
          placeholder="подарок Ане, закупка на неделю"
          onChange={(e) => setNote(e.target.value)}
          style={{ marginBottom: 22 }}
        />

        <button className="cta mint" disabled={!canSave || busy} onClick={() => void save()}>
          {busy ? "Сохраняю…" : `Сохранить ${moneyExact(canSave ? parsedAmount : 0, currency)}`}
        </button>

        {confirmDelete ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="cta"
              style={{ background: "rgba(255,120,120,.2)", color: "#ffb4b4" }}
              onClick={() => void remove()}
            >
              Да, удалить
            </button>
            <button
              className="cta"
              style={{ background: "rgba(255,255,255,.1)", color: "var(--ink)" }}
              onClick={() => setConfirmDelete(false)}
            >
              Оставить
            </button>
          </div>
        ) : (
          <button
            className="cta"
            style={{ marginTop: 10, background: "transparent", color: "var(--ink-3)" }}
            onClick={() => {
              tap();
              setConfirmDelete(true);
            }}
          >
            Удалить трату
          </button>
        )}
      </div>
    </div>
  );
}

/** Откуда взялась категория — видно, кому верить: правилу, модели или себе. */
function provenance(expense: Expense): string {
  const where = expense.source === "bot" ? "из чата" : "из приложения";
  if (expense.needsReview) return `${where} · категория временная`;
  if (expense.confidence === null) return `${where} · категория по твоему правилу`;
  return `${where} · категорию предложила модель`;
}
