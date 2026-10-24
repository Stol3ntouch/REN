import Link from 'next/link';
import { buildHref, firstParam, type SearchParams } from './url';

export type TabItem = { key: string; label: string; count?: number | null; disabled?: boolean };

/** Активная вкладка из `?tab=`: неизвестное значение → первая вкладка. */
export function resolveTab(sp: SearchParams, keys: readonly string[], param = 'tab'): string {
  const raw = firstParam(sp[param]);
  return keys.includes(raw) ? raw : (keys[0] ?? '');
}

/**
 * Вкладки с состоянием в адресе (`?tab=`): ссылки, работают без JS, «назад» возвращает на вкладку.
 * Панель содержимого — `<TabPanel tabs=… active=…>` с aria-labelledby на активную вкладку. При переходе сбрасывается page.
 */
export function Tabs({ items, active, basePath, params = {}, param = 'tab', label = 'Вкладки' }: { items: readonly TabItem[]; active: string; basePath: string; params?: SearchParams; param?: string; label?: string }) {
  return (
    <nav className="ak-tabs" aria-label={label}>
      <ul>
        {items.map((t) => {
          const current = t.key === active;
          const text = t.count === null || t.count === undefined ? t.label : `${t.label} (${t.count})`;
          return (
            <li key={t.key}>
              {t.disabled ? (
                <span className="ak-tabs__tab" aria-disabled="true">
                  {text}
                </span>
              ) : (
                <Link
                  id={`tab-${t.key}`}
                  className="ak-tabs__tab"
                  href={buildHref(basePath, params, { [param]: t === items[0] ? null : t.key, page: null })}
                  aria-current={current ? 'page' : undefined}
                  prefetch={false}
                  scroll={false}
                >
                  {text}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
