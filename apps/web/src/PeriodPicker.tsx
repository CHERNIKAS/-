import { type ReactNode, useState } from "react";
import { IconCalendar } from "./icons.js";
import { PERIODS, type PeriodKey, type Range, rangeFor, rangeTitle } from "./periods.js";
import { tap } from "./telegram.js";

/**
 * Выбор периода.
 *
 * Пресеты — одной прокручиваемой строкой: перенос на три строки съедал пол-экрана
 * и заставлял скроллить разбор. Произвольный диапазон уехал отдельной ссылкой —
 * им пользуются редко, а места в общем ряду он занимал столько же.
 */
export function PeriodPicker({
  today,
  range,
  onChange,
  extra,
}: {
  today: string;
  range: Range;
  onChange: (range: Range) => void;
  /** Например, переключатель «Категории / Валюты» — встаёт в одну строку со ссылкой. */
  extra?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function choose(key: PeriodKey) {
    tap();
    if (key === "custom") {
      setFrom(range.from);
      setTo(range.to);
      setEditing(true);
      return;
    }
    onChange(rangeFor(key, today));
  }

  return (
    <>
      <div className="scroller">
        {PERIODS.filter((p) => p.key !== "custom").map((period) => (
          <button
            key={period.key}
            className={period.key === range.key ? "pill on" : "pill ghost"}
            onClick={() => choose(period.key)}
          >
            {period.title}
          </button>
        ))}
      </div>

      <div className="between" style={{ marginTop: 10 }}>
        {extra ?? <span />}
        <button
          className={range.key === "custom" ? "pill on" : "pill ghost"}
          onClick={() => choose("custom")}
        >
          <IconCalendar />
          {range.key === "custom" ? rangeTitle(range) : "Свой период"}
        </button>
      </div>

      {editing && (
        <div className="sheet short" onClick={() => setEditing(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <p className="label" style={{ marginBottom: 14 }}>
              Свой период
            </p>

            <div className="row" style={{ marginBottom: 10 }}>
              <span className="dim" style={{ width: 22 }}>
                с
              </span>
              <input
                className="field"
                type="date"
                max={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="row" style={{ marginBottom: 20 }}>
              <span className="dim" style={{ width: 22 }}>
                по
              </span>
              <input
                className="field"
                type="date"
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <button
              className="cta mint"
              disabled={from === "" || to === ""}
              onClick={() => {
                // Даты, выбранные наоборот, меняем местами вместо того, чтобы
                // ругаться: человек явно имел в виду интервал между ними.
                const [start, end] = from <= to ? [from, to] : [to, from];
                onChange({ key: "custom", from: start as string, to: end as string });
                setEditing(false);
              }}
            >
              Показать
            </button>
          </div>
        </div>
      )}
    </>
  );
}
