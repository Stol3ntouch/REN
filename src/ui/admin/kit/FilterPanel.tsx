import Link from 'next/link';
import type { ReactNode } from 'react';
import { buildHref, firstParam, type SearchParams } from './url';

/**
 * Панель фильтров списка: обычная GET-форма (работает без JS, состояние в адресе). Поля — children
 * (FormField, SelectField). `preserve` — параметры, которые переживают применение фильтров (сортировка, размер страницы, вкладка);
 * страница при применении сбрасывается. «Сбросить» ведёт на адрес без фильтров, но с `preserve`.
 */
export function FilterPanel({
  basePath,
  params = {},
  preserve = ['sort', 'dir', 'pageSize', 'tab'],
  submitLabel = 'Применить',
  title = 'Фильтры',
  children,
}: {
  basePath: string;
  params?: SearchParams;
  preserve?: readonly string[];
  submitLabel?: string;
  title?: string;
  children: ReactNode;
}) {
  const kept = preserve.filter((k) => firstParam(params[k]) !== '');
  const resetPatch = Object.fromEntries(Object.keys(params).filter((k) => !preserve.includes(k)).map((k) => [k, null]));
  return (
    <form method="get" action={basePath} className="ak-filters" aria-label={title}>
      <div className="ak-filters__fields">{children}</div>
      {kept.map((k) => (
        <input key={k} type="hidden" name={k} value={firstParam(params[k])} />
      ))}
      <div className="ak-filters__actions">
        <button type="submit" className="ak-btn ak-btn--primary">
          {submitLabel}
        </button>
        <Link href={buildHref(basePath, params, resetPatch)} className="ak-btn ak-btn--outline" prefetch={false}>
          Сбросить
        </Link>
      </div>
    </form>
  );
}
