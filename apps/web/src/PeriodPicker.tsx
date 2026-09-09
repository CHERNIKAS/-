import { useState } from "react";
import { PERIODS, type PeriodKey, type Range, rangeFor } from "./periods.js";
import { tap } from "./telegram.js";

/**
 * Выбор периода.
 *
 * Один и тот же на разборе и в истории. «Свой» открывает шторку с двумя
 * датами — без неё набор пресетов рано или поздно упирается в вопрос
 * «а посмотреть с 3 по 17 число?».
 */
export function PeriodPicker({
  today,
  range,
  onChange,
}: {
  today: string;
  range: Range;
  onChange: (range: Range) => void;
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
      <div className="chips">
        {PERIODS.map((period) => (
          <button
            key={period.key}
            className={period.key === range.key ? "pill on" : "pill ghost"}
            onClick={() => choose(period.key)}
          >
            {period.title}
          </button>
        ))}
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
