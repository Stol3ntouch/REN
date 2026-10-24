/**
 * Фокус внутри диалога и выдвижного меню. Чистые функции — проверяются без DOM.
 */

/** Индекс элемента, которому передать фокус по Tab / Shift+Tab; -1 («фокус снаружи») ведёт на первый или последний. */
export function cycleIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (backwards) return current <= 0 ? count - 1 : current - 1;
  return current < 0 || current >= count - 1 ? 0 : current + 1;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Элементы контейнера, до которых доходит Tab (видимые). */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden && el.getClientRects().length > 0);
}
