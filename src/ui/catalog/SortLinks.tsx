import Link from 'next/link';
import { SORT_LABELS, type SortKey } from '@/domain/catalog/types';

const ORDER = ['name', 'popular', 'price_asc', 'price_desc'] as const;

/** Сортировка ссылками: работает без JS, текущая отмечена aria-current. hrefFor(sort) сбрасывает страницу. */
export function SortLinks({ current, hrefFor, withRelevance = false }: { current: SortKey; hrefFor: (sort: SortKey) => string; withRelevance?: boolean }) {
  const keys: SortKey[] = withRelevance ? ['relevance', ...ORDER] : [...ORDER];
  return (
    <nav className="sort-links" aria-label="Сортировка">
      <span className="sort-links__label">Сортировка:</span>
      <ul>
        {keys.map((k) => (
          <li key={k}>
            <Link href={hrefFor(k)} aria-current={k === current ? 'true' : undefined} className={k === current ? 'is-current' : undefined}>
              {k === 'relevance' ? 'По релевантности' : SORT_LABELS[k]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
