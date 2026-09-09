import { useEffect, useRef, useState } from "react";
import { tap } from "./telegram.js";

/**
 * Закрытие шторки смахиванием вниз.
 *
 * Тянуть можно за любое место шторки, а не только за полоску сверху: с
 * открытой клавиатурой до полоски ещё надо дотянуться, и жест по содержимому
 * вместо этого утаскивал страницу за шторкой.
 *
 * Жест начинается только когда содержимое прокручено в самый верх — иначе
 * смахивание спорило бы с обычной прокруткой длинной карточки.
 */
const CLOSE_AT = 110;

export function useSheetDrag(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    let startY: number | null = null;
    let startX = 0;
    let active = false;

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined) return;
      startY = touch.clientY;
      startX = touch.clientX;
      active = false;
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      const node = ref.current;
      if (touch === undefined || startY === null || node === null) return;

      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;

      if (!active) {
        if (dy < 8 || Math.abs(dx) > Math.abs(dy)) return;
        if (node.scrollTop > 0) return;

        active = true;
        setDragging(true);

        // Клавиатуру убираем сами: иначе, чтобы закрыть шторку, её сначала
        // надо спрятать вручную — лишнее действие на ровном месте.
        (document.activeElement as HTMLElement | null)?.blur();
      }

      // Без этого iOS с открытой клавиатурой двигает не шторку, а страницу
      // под ней: видно, как уезжает главный экран.
      event.preventDefault();
      setOffset(Math.max(0, dy));
    }

    function onEnd() {
      const wasActive = active;
      const travelled = offsetRef.current;

      startY = null;
      active = false;
      setDragging(false);

      if (!wasActive) return;

      if (travelled > CLOSE_AT) {
        tap();
        onClose();
        return;
      }

      setOffset(0);
    }

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);

    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [onClose]);

  // Обработчики живут вне React-рендера, поэтому текущее смещение читается
  // через ref, а не из замыкания.
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  return {
    ref,
    sheetStyle: {
      transform: offset === 0 ? undefined : `translateY(${offset}px)`,
      transition: dragging ? "none" : "transform .2s ease",
    },
  };
}
