import Link from 'next/link';
import { Icon } from './icons';
import { pageCountOf, pageWindow, shownRange } from './pagination-model';
import { PageSizeSelect } from './PageSizeSelect';
import { buildHref, type SearchParams } from './url';

/**
 * Пагинация списка: «Показано 1–20 из N», номера страниц (ссылки — работает без JS), выбор размера 10/20/50/100.
 * Состояние в адресе: ?page=&pageSize=; остальные параметры (фильтры, сортировка) сохраняются.
 */
export function Pagination({ page, pageSize, total, basePath, params = {} }: { page: number; pageSize: number; total: number; basePath: string; params?: SearchParams }) {
  const pages = pageCountOf(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const { from, to } = shownRange(current, pageSize, total);
  const href = (p: number) => buildHref(basePath, params, { page: p <= 1 ? null : p });
  return (
    <div className="ak-pager">
      <p className="ak-pager__info" aria-live="polite">
        {total === 0 ? 'Нет записей' : `Показано ${from}–${to} из ${total}`}
      </p>
      {pages > 1 ? (
        <nav className="ak-pager__nav" aria-label="Страницы">
          <ul>
            <li>
              {current > 1 ? (
                <Link href={href(current - 1)} className="ak-pager__btn" aria-label="Предыдущая страница" rel="prev" prefetch={false} scroll={false}>
                  <Icon name="chevron-left" size={16} />
                </Link>
              ) : (
                <span className="ak-pager__btn" aria-disabled="true">
                  <Icon name="chevron-left" size={16} label="Предыдущая страница недоступна" />
                </span>
              )}
            </li>
            {pageWindow(current, pages).map((p, i) =>
              p === 'gap' ? (
                <li key={`gap-${i}`} className="ak-pager__gap" aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={p}>
                  <Link href={href(p)} className="ak-pager__btn" aria-current={p === current ? 'page' : undefined} aria-label={`Страница ${p}`} prefetch={false} scroll={false}>
                    {p}
                  </Link>
                </li>
              ),
            )}
            <li>
              {current < pages ? (
                <Link href={href(current + 1)} className="ak-pager__btn" aria-label="Следующая страница" rel="next" prefetch={false} scroll={false}>
                  <Icon name="chevron-right" size={16} />
                </Link>
              ) : (
                <span className="ak-pager__btn" aria-disabled="true">
                  <Icon name="chevron-right" size={16} label="Следующая страница недоступна" />
                </span>
              )}
            </li>
          </ul>
        </nav>
      ) : null}
      <PageSizeSelect pageSize={pageSize} />
    </div>
  );
}
