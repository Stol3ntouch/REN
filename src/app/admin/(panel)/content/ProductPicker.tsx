'use client';

import { useId, useRef, useState } from 'react';

export type PickedProduct = { id: number; name: string; sku: string | null };

/**
 * Выбор товаров акции: поиск по названию или артикулу (GET /admin/api/content/products), выбранные хранятся
 * скрытыми полями `name`. Сервер всё равно проверяет, что товары существуют.
 */
export function ProductPicker({ name, initial }: { name: string; initial: PickedProduct[] }) {
  const id = useId();
  const [picked, setPicked] = useState<PickedProduct[]>(initial);
  const [found, setFound] = useState<PickedProduct[]>([]);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(q: string): void {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setFound([]);
      setNote('');
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/content/products?q=${encodeURIComponent(q.trim())}`, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('bad');
        const data = (await res.json()) as { items: PickedProduct[] };
        setFound(data.items);
        setNote(data.items.length === 0 ? 'Ничего не найдено' : '');
      } catch {
        setNote('Не удалось выполнить поиск. Повторите.');
      }
    }, 300);
  }

  return (
    <div className="ak-field">
      <label className="ak-field__label" htmlFor={`${id}-q`}>
        Товары акции
      </label>
      <input type="hidden" name={`${name}__present`} value="1" />
      {picked.map((p) => (
        <input key={p.id} type="hidden" name={name} value={p.id} />
      ))}
      <input id={`${id}-q`} type="search" placeholder="Название или артикул (от 2 символов)" onChange={(e) => search(e.target.value)} autoComplete="off" />
      <p className="ak-field__hint" role="status">
        {note}
      </p>
      {found.length > 0 ? (
        <ul className="ak-picker__found">
          {found
            .filter((f) => !picked.some((p) => p.id === f.id))
            .map((f) => (
              <li key={f.id}>
                <button type="button" className="ak-btn ak-btn--sm ak-btn--outline" onClick={() => setPicked((cur) => [...cur, f])}>
                  Добавить
                </button>{' '}
                {f.name}
                {f.sku ? ` · ${f.sku}` : ''}
              </li>
            ))}
        </ul>
      ) : null}
      {picked.length === 0 ? (
        <p className="ak-field__hint">Товары не выбраны.</p>
      ) : (
        <ul className="ak-picker__picked" aria-label="Выбранные товары">
          {picked.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.sku ? ` · ${p.sku}` : ''}{' '}
              <button type="button" className="ak-btn ak-btn--sm ak-btn--danger-outline" onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))} aria-label={`Убрать: ${p.name}`}>
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
