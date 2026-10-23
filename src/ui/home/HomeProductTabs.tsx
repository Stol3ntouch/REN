'use client';

import { useId, useState, type ReactNode } from 'react';

export type ProductTab = { key: string; label: string; content: ReactNode };

/**
 * Вкладки товарного блока («Хиты / Акции / Новинки»). Панели собраны на сервере, здесь только переключение.
 * Клавиатура: стрелки влево/вправо, Home/End. Вкладка одна — переключателя нет, показан только список.
 */
export function HomeProductTabs({ tabs, labelledBy }: { tabs: ProductTab[]; labelledBy: string }) {
  const uid = useId();
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  const move = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };
  return (
    <div className="home-tabs">
      {tabs.length > 1 ? (
        <div className="home-tabs__list" role="tablist" aria-labelledby={labelledBy}>
          {tabs.map((t, i) => (
            <button
              key={t.key}
              id={`${uid}-tab-${i}`}
              type="button"
              role="tab"
              className="home-tabs__tab"
              aria-selected={i === active}
              aria-controls={`${uid}-panel-${i}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => move(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {tabs.map((t, i) => (
        <div key={t.key} id={`${uid}-panel-${i}`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `${uid}-tab-${i}` : undefined} hidden={i !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
