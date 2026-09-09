import { useEffect } from "react";

/**
 * Блокировка прокрутки под шторкой.
 *
 * Без неё палец, не попавший по содержимому шторки, тянет страницу за ней:
 * главный экран уезжает, а шторка остаётся на месте.
 */
export function useBodyLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
