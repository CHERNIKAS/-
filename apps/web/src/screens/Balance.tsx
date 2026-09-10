import { useEffect, useState } from "react";
import { api, type BalanceState } from "../api.js";
import { dayTitle, money, moneyExact } from "../format.js";
import { guessIcon, PALETTE } from "@costnote/core";
import { CategoryIcon } from "../icons.js";
import { tint } from "../palette.js";
import { notify, tap } from "../telegram.js";

const CURRENCIES = ["USD", "EUR", "UAH", "TRY"] as const;

/** Подсказки, а не список: место — свободное слово, у каждого оно своё. */
const PLACES = ["Карта", "Крипта", "Наличка"];

/**
 * Баланс — сколько денег есть сейчас.
 *
 * Он правится движениями, а не перезаписью: «пришло 500», «ушло 200». Остаток
 * складывается сам, и по истории видно, из чего он получился. Перезапись
 * стёрла бы этот след, а вместе с ним и возможность понять, где ошибка.
 *
 * Считается отдельно от трат намеренно: пока наличные тратятся молча, вывести
 * остаток из выписок нельзя, и притворяться обратному — врать.
 */
export function Balance({ currency, today }: { currency: string; today: string }) {
  const [state, setState] = useState<BalanceState | null>(null);
  const [place, setPlace] = useState(PLACES[0] as string);
  const [digits, setDigits] = useState("");
  const [money_, setMoney] = useState<string>(currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setState(await api.balance());
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Не загрузилось"));
  }, []);

  async function move(sign: 1 | -1) {
    const value = Number(digits.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || busy) return;

    setBusy(true);
    try {
      await api.addBalance({
        place: place.trim(),
        amount: value * sign,
        currency: money_,
        happenedAt: today,
      });
      notify("success");
      setDigits("");
      await load();
    } catch (e) {
      notify("error");
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="label" style={{ margin: "12px 2px 8px" }}>
        Сейчас есть
      </p>
      <p className="h1" style={{ marginBottom: 18 }}>
        {money(state?.total ?? 0, currency)}
      </p>

      {error !== null && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

      {(state?.places.length ?? 0) > 0 && (
        <div className="card rows" style={{ padding: "2px 16px", marginBottom: 18 }}>
          {state?.places.map((row, index) => {
            const color = PALETTE[index % PALETTE.length] as string;
            return (
              <div key={`${row.place}-${row.currency}`} className="item">
                <span
                  className="tile"
                  style={{ background: tint(color), color, borderColor: tint(color, 0.24) }}
                >
                  <CategoryIcon slug={guessIcon(row.place).icon} />
                </span>
                <span className="grow">
                  <span className="title">{row.place}</span>
                  <span className="sub">
                    {row.moves} движений · последнее {dayTitle(row.lastAt, today)}
                  </span>
                </span>
                <span className="amount" style={{ color: row.amount < 0 ? "var(--rose)" : undefined }}>
                  {moneyExact(row.amount, row.currency)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="label" style={{ margin: "0 2px 10px" }}>
        Движение
      </p>

      <div className="chips" style={{ marginBottom: 10 }}>
        {[...new Set([...PLACES, ...(state?.places.map((p) => p.place) ?? [])])].map((title) => (
          <button
            key={title}
            className={title === place ? "pill on" : "pill ghost"}
            onClick={() => {
              tap();
              setPlace(title);
            }}
          >
            {title}
          </button>
        ))}
      </div>

      <input
        className="field"
        placeholder="Куда: карта, крипта, наличка"
        value={place}
        maxLength={64}
        onChange={(e) => setPlace(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      <input
        className="field"
        inputMode="decimal"
        placeholder="Сколько"
        value={digits}
        onChange={(e) => setDigits(e.target.value.replace(/[^\d.,]/g, ""))}
        style={{ marginBottom: 10 }}
      />

      <div className="seg" style={{ marginBottom: 14 }}>
        {CURRENCIES.map((code) => (
          <button
            key={code}
            className={code === money_ ? "on" : ""}
            onClick={() => {
              tap();
              setMoney(code);
            }}
          >
            {code}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 22 }}>
        <button className="cta mint" disabled={busy || digits === ""} onClick={() => void move(1)}>
          Прибавить
        </button>
        <button
          className="cta"
          style={{ background: "rgba(255,255,255,.12)", color: "var(--ink)" }}
          disabled={busy || digits === ""}
          onClick={() => void move(-1)}
        >
          Убавить
        </button>
      </div>

      {(state?.entries.length ?? 0) > 0 && (
        <>
          <p className="label" style={{ margin: "0 2px 10px" }}>
            История
          </p>
          <div className="card rows" style={{ padding: "2px 16px" }}>
            {state?.entries.map((entry) => (
              <div key={entry.id} className="item dense">
                <span className="grow">
                  <span className="title">{entry.place}</span>
                  <span className="sub">{dayTitle(entry.happenedAt, today)}</span>
                </span>
                <span
                  className="amount"
                  style={{ color: entry.amount > 0 ? "var(--mint)" : undefined }}
                >
                  {entry.amount > 0 ? "+" : "−"}
                  {moneyExact(Math.abs(entry.amount), entry.currency)}
                </span>
                <button
                  className="linky"
                  style={{ marginLeft: 10 }}
                  onClick={() => {
                    tap();
                    void api
                      .removeBalance(entry.id)
                      .then(load)
                      .catch(() => notify("error"));
                  }}
                >
                  убрать
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
