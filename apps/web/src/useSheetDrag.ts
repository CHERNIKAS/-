import { type TouchEvent, useRef, useState } from "react";
import { tap } from "./telegram.js";

/**
 * Закрытие шторки смахиванием вниз.
 *
 * Полоска-ручка сверху обещает, что шторку можно потянуть, — и раз обещает,
 * то это должно работать. Тянуть можно только за шапку: если разрешить за всё
 * подряд, жест начнёт спорить с прокруткой содержимого.
 */
const CLOSE_AT = 110;

export function useSheetDrag(onClose: () => void) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch === undefined) return;
    start.current = touch.clientY;
    setDragging(true);
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch === undefined || start.current === null) return;
    // Вверх шторка не тянется: там ей уже некуда деваться.
    setOffset(Math.max(0, touch.clientY - start.current));
  }

  function onTouchEnd() {
    start.current = null;
    setDragging(false);

    if (offset > CLOSE_AT) {
      tap();
      onClose();
      return;
    }

    setOffset(0);
  }

  return {
    /** Вешается на шапку шторки — полоску и заголовок. */
    handleProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    /** Стиль самой шторки: она едет за пальцем. */
    sheetStyle: {
      transform: offset === 0 ? undefined : `translateY(${offset}px)`,
      transition: dragging ? "none" : "transform .2s ease",
    },
  };
}
