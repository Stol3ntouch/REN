'use client';

import { useState, type ReactNode } from 'react';
import './product-form.css';

export type ProductTab = { key: string; label: string };

/**
 * Вкладки карточки товара. Все панели лежат на странице сразу (одна форма, одно сохранение), переключение только прячет лишние:
 * без JS видны все панели подряд. Панель — элемент с data-panel="<ключ>".
 */
export function ProductTabs({ tabs, initial, children }: { tabs: readonly ProductTab[]; initial?: string; children: ReactNode }) {
  const [active, setActive] = useState(initial && tabs.some((t) => t.key === initial) ? initial : (tabs[0]?.key ?? ''));
  return (
    <div className="pf" data-active={active}>
      <div className="ak-tabs" role="tablist" aria-label="Разделы карточки товара">
        <ul>
          {tabs.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                role="tab"
                id={`ptab-${t.key}`}
                aria-selected={t.key === active}
                aria-controls={`ppanel-${t.key}`}
                className="ak-tabs__tab pf__tab"
                onClick={() => setActive(t.key)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {children}
    </div>
  );
}
