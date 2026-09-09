import { type ReactNode, useRef, useState } from "react";
import { notify, tap } from "./telegram.js";

/**
 * Строка списка со свайпом влево.
 *
 * Удаление в два шага: свайп открывает кнопку, нажатие спрашивает
 * подтверждение. Одного жеста мало — смахнуть строку случайно проще, чем
 * попасть по кнопке, а трата не должна исчезать без спроса.
 */

const OPEN_AT = 72;

export function SwipeRow({
  children,
  onDelete,
  label = "Удалить",
}: {
  children: ReactNode;
  onDelete: () => Promise<void> | void;
  label?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef(false);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (touch === undefined) return;
    start.current = { x: touch.clientX, y: touch.clientY };
    horizontal.current = false;
  }

  function onTouchMove(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (touch === undefined || start.current === null) return;

    const dx = touch.clientX - start.current.x;
    const dy = touch.clientY - start.current.y;

    // Направление жеста решается один раз: иначе список дёргается вбок при
    // обычной вертикальной прокрутке.
    if (!horizontal.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      horizontal.current = true;
    }

    if (!horizontal.current) return;
    setOffset(Math.max(-96, Math.min(0, dx)));
  }

  function onTouchEnd() {
    if (!horizontal.current) return;
    const open = offset < -OPEN_AT / 2;
    setOffset(open ? -OPEN_AT : 0);
    if (!open) setConfirming(false);
    start.current = null;
  }

  async function remove() {
    if (busy) return;

    if (!confirming) {
      tap("medium");
      setConfirming(true);
      return;
    }

    setBusy(true);
    try {
      await onDelete();
    } catch {
      notify("error");
    } finally {
      setBusy(false);
      setOffset(0);
      setConfirming(false);
    }
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <button
        onClick={() => void remove()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: confirming ? 96 : OPEN_AT,
          borderRadius: 12,
          margin: "6px 0",
          fontSize: 12,
          fontWeight: 600,
          color: "#ffd7d7",
          background: confirming ? "rgba(255,90,90,.45)" : "rgba(255,120,120,.22)",
        }}
      >
        {busy ? "…" : confirming ? "Точно?" : label}
      </button>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: start.current === null ? "transform .18s ease" : "none",
          background: "transparent",
        }}
      >
        {children}
      </div>
    </div>
  );
}
