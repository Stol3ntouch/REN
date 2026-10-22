'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const DESKTOP_QUERY = '(min-width: 64rem)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function subscribeDesktop(cb: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const noop = () => () => {};

/**
 * Фильтры: на широком экране — обычная боковая панель; на телефоне (после гидратации) — выезжающая
 * панель-диалог: фокус заперт внутри, Esc и подложка закрывают, фокус возвращается на кнопку.
 * Без JS панель остаётся обычным блоком на странице (форма GET работает как есть).
 */
export function FilterDrawer({ children, activeCount }: { children: ReactNode; activeCount: number }) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, () => true);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const drawer = hydrated && !desktop;
  const isOpen = drawer && open;

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const trigger = triggerRef.current;
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    (focusables()[0] ?? panel).focus();
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel!.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel!.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
      trigger?.focus();
    };
  }, [isOpen]);

  return (
    <div className="filters" data-mode={drawer ? (isOpen ? 'open' : 'closed') : 'inline'}>
      {drawer ? (
        <button
          ref={triggerRef}
          type="button"
          className="button button--outline filters__toggle"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setOpen(true)}
        >
          Фильтры{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      ) : null}
      {isOpen ? <div className="filters__backdrop" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      <div
        ref={panelRef}
        className="filters__panel"
        role={drawer ? 'dialog' : undefined}
        aria-modal={isOpen ? true : undefined}
        aria-label={drawer ? 'Фильтры' : undefined}
        tabIndex={drawer ? -1 : undefined}
        hidden={drawer && !isOpen}
      >
        {drawer ? (
          <button type="button" className="filters__close" onClick={() => setOpen(false)} aria-label="Закрыть фильтры">
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
