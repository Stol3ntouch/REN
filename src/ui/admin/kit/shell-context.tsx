'use client';

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './icons';
import { navCookieString } from './shell-constants';

type ShellState = {
  collapsed: boolean;
  drawerOpen: boolean;
  toggleCollapsed: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

/** Состояние каркаса: свёрнута ли панель (хранится в cookie) и открыто ли выдвижное меню на узком экране. */
export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell: нет ShellProvider (оберните страницу в AdminLayout)');
  return ctx;
}

const NARROW_QUERY = '(max-width: 63.999rem)';

/** Узкий экран (< 1024 px): панель работает как выдвижное меню. На сервере — false. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(NARROW_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

export function ShellProvider({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = navCookieString(next, window.location.protocol === 'https:');
    } catch {
      /* cookie недоступны — состояние остаётся только на эту вкладку */
    }
  }, [collapsed]);

  const value = useMemo<ShellState>(
    () => ({
      collapsed,
      drawerOpen,
      toggleCollapsed,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      toggleDrawer: () => setDrawerOpen((o) => !o),
    }),
    [collapsed, drawerOpen, toggleCollapsed],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className="ak-app ak-shell" data-collapsed={collapsed ? 'true' : 'false'} data-drawer={drawerOpen ? 'open' : 'closed'}>
        {children}
      </div>
    </ShellContext.Provider>
  );
}

/** Затемнение за выдвижным меню; клик закрывает его. */
export function ShellOverlay() {
  const { drawerOpen, closeDrawer } = useShell();
  return <div className="ak-overlay" data-open={drawerOpen ? 'true' : 'false'} onClick={closeDrawer} aria-hidden="true" />;
}

/** Кнопка-бургер верхней панели (только на узких экранах). */
export function MenuButton() {
  const { drawerOpen, toggleDrawer } = useShell();
  return (
    <button type="button" className="ak-iconbtn ak-burger" onClick={toggleDrawer} aria-expanded={drawerOpen} aria-controls="ak-sidebar" aria-label="Открыть меню">
      <Icon name="menu" size={22} />
    </button>
  );
}
