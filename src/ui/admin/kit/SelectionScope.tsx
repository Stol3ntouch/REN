'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const ROW = 'input[data-ak-row]';

/**
 * Выбор строк таблицы: следит за чекбоксами `data-ak-row` внутри, считает выбранные, управляет «выбрать все»
 * (`data-ak-all`) и показывает панель массовых действий `bulk`, когда что-то выбрано.
 * Сами чекбоксы строк связаны с формой массового действия атрибутом `form`, поэтому ids уходят в server action без JS-состояния.
 */
export function SelectionScope({ children, bulk }: { children: ReactNode; bulk?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  function recount(): void {
    const rows = Array.from(root.current?.querySelectorAll<HTMLInputElement>(ROW) ?? []);
    const selected = rows.filter((r) => r.checked).length;
    setCount(selected);
    setTotal(rows.length);
    const all = root.current?.querySelector<HTMLInputElement>('input[data-ak-all]');
    if (all) {
      all.checked = rows.length > 0 && selected === rows.length;
      all.indeterminate = selected > 0 && selected < rows.length;
    }
  }

  // Страница могла вернуться из кеша браузера с отмеченными чекбоксами.
  useEffect(() => {
    recount();
  }, []);

  return (
    <div
      ref={root}
      className="ak-selection"
      onChange={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.matches?.('input[data-ak-all]')) {
          root.current?.querySelectorAll<HTMLInputElement>(ROW).forEach((r) => {
            r.checked = t.checked;
          });
        }
        recount();
      }}
    >
      {bulk ? (
        <div className="ak-bulk" hidden={count === 0} role="region" aria-label="Массовые действия">
          <p className="ak-bulk__count" aria-live="polite">
            Выбрано: {count}
            {total > 0 ? ` из ${total}` : ''}
          </p>
          <div className="ak-bulk__actions">{bulk}</div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
