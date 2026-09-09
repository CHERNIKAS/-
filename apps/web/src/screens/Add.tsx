import { useState } from "react";
import { api, type Category } from "../api.js";
import { moneyExact } from "../format.js";
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
  currency,
  onDone,
  onClose,
}: {
  categories: Category[];
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

  const amount = Number(digits.replace(",", ".")) || 0;
  const canSave = mode === "text" ? text.trim() !== "" : amount > 0;

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);

    try {
      if (mode === "text") {
        await api.createFromText(text.trim());
      } else {
        await api.create({
          amount,
          currency,
          ...(slug === null ? {} : { categorySlug: slug }),
        });
      }
      notify("success");
      onDone();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const visible = allCategories ? categories : categories.slice(0, 5);

  return (
    <div className="sheet" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />

        <div className="between" style={{ marginBottom: 14 }}>
          <span className="label">Новая трата</span>
          <span className="pill ghost">{currency}</span>
        </div>

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
              placeholder="магаз 15 лир"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <p className="dim" style={{ margin: "10px 2px 16px" }}>
              Сумму, валюту и день пойму из строки. Категорию подберу сам.
            </p>
          </>
        ) : (
          <>
            <p className="h1" style={{ textAlign: "center", margin: "10px 0 18px" }}>
              {digits === "" ? "0" : digits}
            </p>

            <div className="chips" style={{ marginBottom: 14, justifyContent: "center" }}>
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
              {!allCategories && categories.length > 5 && (
                <button className="pill ghost" onClick={() => setAllCategories(true)}>
                  Все категории
                </button>
              )}
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

function nextDigits(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ",") return current.includes(",") ? current : `${current === "" ? "0" : current},`;

  // Больше двух знаков после запятой в сумме не бывает.
  const [, fraction] = current.split(",");
  if (fraction !== undefined && fraction.length >= 2) return current;

  return current === "0" ? key : current + key;
}
