'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const DESKTOP_QUERY = '(min-width: 64rem)';

function subscribe(cb: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

/**
 * Сворачиваемый блок: на телефоне закрыт (не уводит каталог вниз экрана), на широком экране раскрыт.
 * Без JS — закрыт и раскрывается нажатием, содержимое остаётся в разметке.
 */
export function ResponsiveDetails({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  return (
    <details className={className} open={desktop}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
