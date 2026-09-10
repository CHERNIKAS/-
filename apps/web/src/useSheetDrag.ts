import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * Во время жеста transform пишется прямо в стиль узла и обновляется раз в
 * кадр: рендер React на каждое движение пальца и был причиной рывков.
 */
const CLOSE_AT = 110;

export function useSheetDrag(onClose: () => void) {
  /**
   * Узел приходит через колбэк-ссылку, а не через useRef: шторки валюты и
   * периода появляются позже самого хука, и эффект на обычном ref срабатывал
   * раньше, чем элемент существовал, — слушатели не вешались вовсе.
   */
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => setNode(element), []);
  const offset = useRef(0);

  useEffect(() => {
    if (node === null) return;

    let startY = 0;
    let startX = 0;
    let active = false;
    let frame = 0;

    function paint(dy: number) {
      if (node === null) return;
      node.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
    }

    function settle(dy: number) {
      if (node === null) return;
      node.style.transition = "transform .3s cubic-bezier(.22,.9,.3,1)";
      paint(dy);
    }

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined || node === null) return;
      startY = touch.clientY;
      startX = touch.clientX;
      active = false;
      node.style.transition = "none";
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined || node === null) return;

      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;

      if (!active) {
        if (dy < 8 || Math.abs(dx) > Math.abs(dy)) return;
        if (node.scrollTop > 0) return;

        active = true;

        // Клавиатуру убираем сами: иначе, чтобы закрыть шторку, её сначала
        // надо спрятать вручную — лишнее действие на ровном месте.
        (document.activeElement as HTMLElement | null)?.blur();
      }

      // Без этого iOS с открытой клавиатурой двигает не шторку, а страницу
      // под ней: видно, как уезжает главный экран.
      event.preventDefault();

      // Ниже порога шторка идёт за пальцем один в один, дальше — с
      // сопротивлением: так понятно, что предел близко.
      offset.current = dy > CLOSE_AT ? CLOSE_AT + (dy - CLOSE_AT) * 0.5 : Math.max(0, dy);

      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint(offset.current);
      });
    }

    function onEnd() {
      if (!active) return;
      active = false;

      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }

      if (offset.current > CLOSE_AT) {
        tap();
        settle(window.innerHeight);
        offset.current = 0;
        onClose();
        return;
      }

      settle(0);
      offset.current = 0;
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
  }, [node, onClose]);

  return {
    ref,
    sheetStyle: {
      willChange: "transform",
      transition: "transform .3s cubic-bezier(.22,.9,.3,1)",
    },
  };
}
