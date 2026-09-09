import { type ReactNode, useEffect, useRef, useState } from "react";
import { tap } from "./telegram.js";

/**
 * Строка, которую можно смахнуть влево.
 *
 * Карточка уходит за пальцем и улетает, а подтверждение спрашивается по
 * центру экрана. Кнопки под строкой нет намеренно: она занимает место, видна
 * до всякого жеста и превращает смахивание в лишний шаг перед нажатием.
 */

/** Дальше этого отпускание считается смахиванием, а не случайным движением. */
const THRESHOLD = 96;

export function SwipeRow({
  children,
  onSwipe,
}: {
  children: ReactNode;
  /** Вызывается после того, как строка улетела. reset возвращает её на место. */
  onSwipe: (reset: () => void) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [flown, setFlown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const node = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef(false);

  /**
   * Слушатель ставится вручную, потому что React вешает touchmove пассивно, а
   * без preventDefault страница уезжает вместе со строкой.
   */
  useEffect(() => {
    const element = node.current;
    if (element === null) return;

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined || start.current === null) return;

      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;

      if (!horizontal.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        horizontal.current = true;
        setDragging(true);
      }

      if (!horizontal.current) return;

      event.preventDefault();
      setOffset(Math.min(0, dx));
    }

    element.addEventListener("touchmove", onMove, { passive: false });
    return () => element.removeEventListener("touchmove", onMove);
  }, []);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (touch === undefined || flown) return;
    start.current = { x: touch.clientX, y: touch.clientY };
    horizontal.current = false;
  }

  function onTouchEnd() {
    start.current = null;
    setDragging(false);

    if (!horizontal.current) return;
    horizontal.current = false;

    if (offset > -THRESHOLD) {
      setOffset(0);
      return;
    }

    tap("medium");
    setFlown(true);
    setOffset(-window.innerWidth);
    onSwipe(() => {
      setFlown(false);
      setOffset(0);
    });
  }

  // Пока строка улетает, она освобождает место плавно, а не рывком.
  const collapsed = flown ? { maxHeight: 0, opacity: 0 } : {};

  return (
    <div
      ref={node}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        touchAction: "pan-y",
        overflow: "hidden",
        transform: `translateX(${offset}px)`,
        opacity: flown ? 0 : 1 + Math.max(-0.6, offset / 400),
        transition: dragging ? "none" : "transform .22s ease, opacity .22s ease, max-height .22s ease",
        ...collapsed,
      }}
    >
      {children}
    </div>
  );
}
