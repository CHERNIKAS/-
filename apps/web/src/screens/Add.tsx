import { useEffect, useState } from "react";
import { api, type Category } from "../api.js";
import { moneyExact } from "../format.js";
import { CategorySheet } from "../CategorySheet.js";
import { useSheetDrag } from "../useSheetDrag.js";
import { useBodyLock } from "../useBodyLock.js";
import { IconKeypad, IconText } from "../icons.js";
import { notify, tap } from "../telegram.js";

/**
 * Добавление траты.
 *
 * Два режима, и никогда оба сразу: строка с системной клавиатурой либо
 * цифровая панель с плитками категорий. Два способа ввода на одном экране —
 * это шум, а не удобство.
 */
export function Add({
  categories,
  incomeSources,
  currency: defaultCurrency,
  onDone,
  onClose,
}: {
  categories: Category[];
  incomeSources: string[];
  currency: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"text" | "keys">("text");
  const [text, setText] = useState("");
  const [digits, setDigits] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  /**
   * Расход или доход.
   *
   * Переключатель, а не отдельный экран: деньги приходят реже, чем уходят, но
   * когда приходят — это то же самое действие, только в другую сторону.
   */
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [source, setSource] = useState<string>(incomeSources[0] ?? "Поступления");
  const [done, setDone] = useState<string | null>(null);
  useBodyLock(true);
  const drag = useSheetDrag(onClose);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  const amount = Number(digits.replace(",", ".")) || 0;
  const canSave = mode === "text" ? text.trim() !== "" : amount > 0;
  /**
   * Примеры крутятся прямо в подсказке поля.
   *
   * Отдельные кнопки с примерами занимали место и требовали решения: нажать
   * или не нажать. Строка в поле ничего не требует — её замечают краем глаза,
   * пока думают, что писать.
   */
  const examples = kind === "income" ? INCOME_EXAMPLES : EXPENSE_EXAMPLES;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (text !== "") return;

    const timer = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(timer);
  }, [text, kind]);

  const placeholder = examples[tick % examples.length] ?? "";

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result =
        mode === "text"
          ? // Валюта из строки главнее выбранной пилюлей: человек написал её явно.
            await api.createFromText(text.trim(), currency, kind, source)
          : await api.create({
              amount,
              currency,
              kind,
              ...(kind === "income" ? { incomeSource: source } : {}),
              ...(slug === null || kind === "income" ? {} : { categorySlug: slug }),
            });

      notify("success");

      // Возврат ничего не создаёт — он гасит прошлую покупку. Промолчать здесь
      // значит оставить человека гадать, случилось ли что-нибудь вообще.
      if (result.created.length === 0 && result.refunded > 0) {
        setDone(result.refunded === 1 ? "Возврат погасил покупку" : `Погашено покупок: ${result.refunded}`);
        setTimeout(onDone, 1400);
        return;
      }

      onDone();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const visible = categories.slice(0, 5);

  if (allCategories) {
    return (
      <CategorySheet
        categories={categories}
        current={slug}
        onClose={() => setAllCategories(false)}
        onPick={(picked) => {
          setSlug(picked);
          setAllCategories(false);
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

        <div className="between" style={{ marginBottom: 14 }}>
          <span className="label">{kind === "income" ? "Новый доход" : "Новая трата"}</span>
          <button
            className="pill"
            onClick={() => {
              tap();
              setPickingCurrency((open) => !open);
            }}
          >
            {currency}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {pickingCurrency && (
          <div className="chips" style={{ marginBottom: 14, justifyContent: "flex-end" }}>
            {CURRENCIES.map((code) => (
              <button
                key={code}
                className={code === currency ? "pill on" : "pill ghost"}
                onClick={() => {
                  tap();
                  setCurrency(code);
                  setPickingCurrency(false);
                }}
              >
                {code}
              </button>
            ))}
          </div>
        )}

        <div className="seg" style={{ marginBottom: 14 }}>
          {(["expense", "income"] as const).map((value) => (
            <button
              key={value}
              className={kind === value ? "on" : ""}
              onClick={() => {
                tap();
                setKind(value);
              }}
            >
              {value === "expense" ? "Расход" : "Доход"}
            </button>
          ))}
        </div>

        {kind === "income" && (
          <div className="chips" style={{ marginBottom: 14 }}>
            {incomeSources.map((title) => (
              <button
                key={title}
                className={title === source ? "pill on" : "pill ghost"}
                onClick={() => {
                  tap();
                  setSource(title);
                }}
              >
                {title}
              </button>
            ))}
          </div>
        )}

        {done !== null && (
          <div className="card" style={{ padding: 14, marginBottom: 12, textAlign: "center" }}>
            {done}
          </div>
        )}

        {error !== null && (
          <div className="err" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {mode === "text" ? (
          <>
            <input
              className="field"
              autoFocus
              placeholder={placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <p className="dim" style={{ margin: "0 2px 16px" }}>
              Пиши как удобно: сумму, валюту и день пойму сам.
              {kind === "expense" && " Категорию подберу тоже."}
              {currency !== defaultCurrency && ` Без валюты запишу в ${currency}.`}
            </p>
          </>
        ) : (
          <>
            <p className="h1" style={{ textAlign: "center", margin: "10px 0 18px" }}>
              {digits === "" ? "0" : digits}
            </p>

            <div
              className="chips"
              style={{ marginBottom: 14, justifyContent: "center" }}
              hidden={kind === "income"}
            >
              {visible.map((c) => (
                <button
                  key={c.slug}
                  className={slug === c.slug ? "pill on" : "pill"}
                  onClick={() => {
                    tap();
                    setSlug(c.slug);
                  }}
                >
                  {c.title}
                </button>
              ))}
              <button className="pill ghost" onClick={() => setAllCategories(true)}>
                Все категории
              </button>
            </div>

            <div className="keys" style={{ marginBottom: 14 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    tap();
                    setDigits((current) => nextDigits(current, key));
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button
            className="pill"
            style={{ padding: "14px 16px" }}
            onClick={() => {
              tap();
              setMode(mode === "text" ? "keys" : "text");
            }}
          >
            {mode === "text" ? <IconKeypad /> : <IconText />}
          </button>
          <button className="cta mint" disabled={!canSave || busy} onClick={() => void save()}>
            {busy ? "Сохраняю…" : mode === "keys" && amount > 0 ? `Сохранить ${moneyExact(amount, currency)}` : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

/**
 * Примеры, а не правила.
 *
 * Каждый показывает что-то одно: сленг вместо названия, вчерашний день,
 * копейки через точку, две траты подряд. Больше четырёх — это уже справочник,
 * который никто не читает.
 */
const EXPENSE_EXAMPLES = [
  "магаз 15 лир",
  "такси 12 вчера",
  "кофе 4.50, аптека 30",
  "продукты 800 грн 5 сентября",
  "аптека 250 05.09.2026",
];

const INCOME_EXAMPLES = ["+500", "зарплата 2500 вчера", "поступление 60000 лир"];

function nextDigits(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ",") return current.includes(",") ? current : `${current === "" ? "0" : current},`;

  // Больше двух знаков после запятой в сумме не бывает.
  const [, fraction] = current.split(",");
  if (fraction !== undefined && fraction.length >= 2) return current;

  return current === "0" ? key : current + key;
}
