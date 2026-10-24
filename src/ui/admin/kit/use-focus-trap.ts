'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cycleIndex, focusableIn } from './focus';

type Options = {
  /** Esc: закрыть. */
  onEscape?: () => void;
  /** Куда поставить фокус при открытии (по умолчанию — первый доступный элемент). */
  initialFocus?: () => HTMLElement | null;
};

/**
 * Запирает Tab внутри контейнера, пока `active`; Esc вызывает onEscape; при закрытии фокус возвращается туда,
 * откуда его забрали.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active: boolean, options: Options = {}): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!active) return;
    const root = container.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = latest.current.initialFocus?.() ?? focusableIn(root)[0] ?? root;
    first.focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.onEscape?.();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[cycleIndex(items.length, index, e.shiftKey)]?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active, container]);
}
