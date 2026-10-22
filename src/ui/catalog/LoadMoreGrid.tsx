'use client';

import { useRef, useState } from 'react';
import type { ProductCard as ProductCardData, SearchResult } from '@/domain/catalog/types';
import { ProductCard } from './ProductCard';

/** Объединяет страницы без дублей по id, сохраняя порядок. */
export function mergeUnique(existing: ProductCardData[], incoming: ProductCardData[]): ProductCardData[] {
  const seen = new Set(existing.map((p) => p.id));
  const out = [...existing];
  for (const p of incoming) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

type Status = 'idle' | 'loading' | 'error';

/**
 * Сетка с «Показать ещё». Первая порция приходит с сервера (работает и без JS — тогда страницы
 * листаются ссылками ?page=N). Родитель задаёт key по строке запроса: смена фильтра/сортировки
 * пересоздаёт компонент и сбрасывает накопленный список.
 */
export function LoadMoreGrid({
  initialItems,
  total,
  startPage,
  hasMore: initialHasMore,
  apiQuery,
}: {
  initialItems: ProductCardData[];
  total: number;
  startPage: number;
  hasMore: boolean;
  /** Параметры запроса к /api/catalog/products без page. */
  apiQuery: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(startPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [status, setStatus] = useState<Status>('idle');
  const busy = useRef(false);

  async function loadMore() {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading');
    try {
      const next = page + 1;
      const sep = apiQuery === '' ? '' : '&';
      const res = await fetch(`/api/catalog/products?${apiQuery}${sep}page=${next}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Partial<SearchResult>;
      if (!Array.isArray(data.items)) throw new Error('bad response');
      setItems((cur) => mergeUnique(cur, data.items as ProductCardData[]));
      setPage(next);
      setHasMore(Boolean(data.hasMore));
      setStatus('idle');
    } catch {
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }

  return (
    <>
      <ul className="product-grid">
        {items.map((p, i) => (
          <li key={p.id}>
            <ProductCard product={p} priority={i < 4 && startPage === 1} />
          </li>
        ))}
      </ul>
      <div className="load-more">
        <p className="load-more__summary" role="status" aria-live="polite">
          Показано {items.length} из {total}
        </p>
        {status === 'error' ? (
          <p className="load-more__error" role="alert">
            Не удалось загрузить товары. Проверьте соединение.
          </p>
        ) : null}
        {hasMore ? (
          <button type="button" className="button button--outline" onClick={loadMore} disabled={status === 'loading'} aria-busy={status === 'loading'}>
            {status === 'loading' ? 'Загружаем…' : status === 'error' ? 'Повторить' : 'Показать ещё'}
          </button>
        ) : null}
      </div>
    </>
  );
}
