'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/ui/admin/kit';

type Item = { id: number; name: string };
type Hit = { id: number; name: string; path: string };

/**
 * Связанные категории: поиск по названию, добавление нескольких, теги, удаление. Выбранные уходят в форму скрытыми полями
 * relatedIds; дубли и связь с самой категорией не добавляются (сервер проверяет это ещё раз).
 */
export function RelatedPicker({ selfId, initial, disabled = false }: { selfId: number; initial: Item[]; disabled?: boolean }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q === '') return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/categories/children?q=${encodeURIComponent(q)}`, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error('search');
        setError(null);
        setHits(((await res.json()) as { hits: Hit[] }).hits);
      } catch {
        setError('Поиск не удался. Попробуйте ещё раз.');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const taken = new Set([selfId, ...items.map((i) => i.id)]);
  const visible = query.trim() === '' ? [] : hits.filter((h) => !taken.has(h.id));

  return (
    <div className="cat-related">
      {!disabled ? (
        <div className="cat-related__search">
          <Icon name="search" size={16} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск и выбор категорий…" aria-label="Поиск связанных категорий" autoComplete="off" maxLength={100} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="cat-related__error">
          {error}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="cat-related__hits" aria-label="Найденные категории">
          {visible.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  setItems((cur) => [...cur, { id: h.id, name: h.name }]);
                  setQuery('');
                }}
              >
                <strong>{h.name}</strong>
                <small>{h.path}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="cat-related__tags" aria-label="Связанные категории">
        {items.map((i) => (
          <li key={i.id}>
            <span>{i.name}</span>
            {!disabled ? (
              <button type="button" aria-label={`Убрать «${i.name}»`} onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))}>
                <Icon name="x" size={14} />
              </button>
            ) : null}
            <input type="hidden" name="relatedIds" value={i.id} />
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p className="cat-hint">Связанных категорий нет.</p> : <p className="cat-hint">Выбранные категории показываются покупателям блоком «Смотрите также» на странице этой категории.</p>}
    </div>
  );
}
