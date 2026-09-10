import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { tap } from "./telegram.js";

/**
 * Строка, которую можно смахнуть влево.
 *
 * Карточка идёт за пальцем и улетает, а подтверждение спрашивается по центру
 * экрана. Кнопки под строкой нет намеренно: она занимает место, видна до
 * всякого жеста и превращает смахивание в лишний шаг перед нажатием.
 *
 * Во время жеста transform пишется прямо в стиль узла, без состояния React:
 * рендер на каждое движение пальца — это те самые рывки, из-за которых свайп
 * ощущается дёрганым.
 */

/** Дальше этого отпускание считается смахиванием, а не случайным движением. */
const THRESHOLD = 96;

/** Наклон при уходе — от него жест читается как карточка, а не как полоска. */
const TILT = 0.04;

export function SwipeRow({
  children,
  onSwipe,
}: {
  children: ReactNode;
  /** Вызывается после того, как строка улетела. reset возвращает её на место. */
  onSwipe: (reset: () => void) => void;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => setNode(element), []);
  const offset = useRef(0);

  const reset = useCallback(() => {
    if (node === null) return;
    node.style.transition = "transform .32s cubic-bezier(.22,.9,.3,1), opacity .32s ease, max-height .32s ease";
    node.style.transform = "";
    node.style.opacity = "1";
    node.style.maxHeight = "";
    offset.current = 0;
  }, [node]);

  useEffect(() => {
    if (node === null) return;

    let startX = 0;
    let startY = 0;
    let active = false;
    let frame = 0;

    function paint(dx: number) {
      if (node === null) return;
      // Наклон и прозрачность считаются от смещения, поэтому карточка
      // «оживает» постепенно, а не переключается между двумя состояниями.
      node.style.transform = `translateX(${dx}px) rotate(${dx * TILT}deg)`;
      node.style.opacity = String(Math.max(0.35, 1 + dx / 520));
    }

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined || node === null) return;
      startX = touch.clientX;
      startY = touch.clientY;
      active = false;
      node.style.transition = "none";
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!active) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        active = true;
      }

      event.preventDefault();
      offset.current = Math.min(0, dx);

      // Рисуем раз в кадр: несколько событий подряд между кадрами всё равно
      // видны одним движением, а лишняя работа делает жест тяжёлым.
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint(offset.current);
      });
    }

    function onEnd() {
      if (!active || node === null) return;
      active = false;

      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }

      if (offset.current > -THRESHOLD) {
        node.style.transition = "transform .28s cubic-bezier(.22,.9,.3,1), opacity .28s ease";
        node.style.transform = "";
        node.style.opacity = "1";
        offset.current = 0;
        return;
      }

      tap("medium");
      node.style.transition = "transform .26s cubic-bezier(.4,0,.6,1), opacity .26s ease, max-height .26s ease .06s";
      node.style.transform = `translateX(${-window.innerWidth}px) rotate(${-window.innerWidth * TILT}deg)`;
      node.style.opacity = "0";
      node.style.maxHeight = "0px";

      onSwipe(reset);
    }

    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);

    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [node, onSwipe, reset]);

  return (
    <div
      ref={ref}
      style={{
        touchAction: "pan-y",
        overflow: "hidden",
        willChange: "transform",
        transition: "transform .28s cubic-bezier(.22,.9,.3,1), opacity .28s ease",
      }}
    >
      {children}
    </div>
  );
}
