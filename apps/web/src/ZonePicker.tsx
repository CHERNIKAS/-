import { useMemo, useState } from "react";
import { tap } from "./telegram.js";
import { useBodyLock } from "./useBodyLock.js";
import { useSheetDrag } from "./useSheetDrag.js";

/**
 * Выбор часового пояса.
 *
 * Список берётся у самого браузера — это все пояса, которые он знает, а не
 * восемь на наш вкус. Восьми хватает ровно до того момента, когда человек
 * переезжает в девятый.
 *
 * Рядом с каждым — местное время: название пояса мало кто помнит наизусть, а
 * «сейчас 06:27» узнаётся мгновенно.
 */
export function ZonePicker({
  current,
  onPick,
  onClose,
}: {
  current: string;
  onPick: (zone: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  useBodyLock(true);
  const drag = useSheetDrag(onClose);

  const zones = useMemo(() => allZones(), []);
  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle === "" ? zones : zones.filter((z) => z.toLowerCase().includes(needle));

    // Свой пояс всегда наверху: чаще всего сюда заходят посмотреть, а не сменить.
    return [current, ...matched.filter((z) => z !== current)].slice(0, 200);
  }, [zones, query, current]);

  return (
    <div className="sheet" onClick={onClose}>
      <div
        ref={drag.ref}
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", ...drag.sheetStyle }}
      >
        <div className="grabber" />

        <p className="label" style={{ marginBottom: 10 }}>
          Часовой пояс
        </p>

        <input
          className="field"
          placeholder="Поиск: Istanbul, Kyiv, Lisbon"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        <div className="card rows" style={{ padding: "2px 16px" }}>
          {found.length === 0 && (
            <p className="muted" style={{ padding: "20px 0" }}>
              Ничего не нашлось
            </p>
          )}

          {found.map((zone) => (
            <button
              key={zone}
              className="item"
              onClick={() => {
                tap();
                onPick(zone);
              }}
            >
              <span className="grow">
                <span className="title">{zone.replace("_", " ")}</span>
                <span className="sub">сейчас {localTime(zone)}</span>
              </span>
              {zone === current && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4.5 4.5L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Полный список поясов браузера; если его нет — короткий запасной. */
function allZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;

  try {
    const list = supported?.("timeZone");
    if (list !== undefined && list.length > 0) return list;
  } catch {
    // Старый движок — ниже запасной список.
  }

  return [
    "Europe/Istanbul", "Europe/Kyiv", "Europe/Warsaw", "Europe/Lisbon", "Europe/Berlin",
    "Europe/London", "Europe/Madrid", "Europe/Rome", "Europe/Prague", "Europe/Belgrade",
    "Asia/Tbilisi", "Asia/Yerevan", "Asia/Dubai", "Asia/Almaty", "Asia/Bangkok",
    "Asia/Jerusalem", "Asia/Nicosia", "America/New_York", "America/Los_Angeles", "UTC",
  ];
}

function localTime(zone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "—";
  }
}
