'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getServerSnapshot, getSnapshot, mutate, refresh, subscribe, type CollectionKind } from './collections-store';
import './collection-button.css';

/**
 * Общая кнопка-переключатель «в избранное» / «в сравнение»: нативная <button> (Enter/Space),
 * aria-pressed отражает состояние, подпись постоянная (меняется только pressed), ошибка сервера показывается рядом.
 */
export function CollectionButton({
  kind,
  productId,
  name,
  label,
  pressedText,
  idleText,
  icon,
  variant,
}: {
  kind: CollectionKind;
  productId: number;
  name: string;
  /** Постоянная доступная подпись без названия товара, например «Избранное». */
  label: string;
  pressedText: string;
  idleText: string;
  icon: ReactNode;
  variant: 'icon' | 'text';
}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pressed = snap[kind].has(productId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    const res = await mutate(kind, productId, !pressed);
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(''), 6000);
    }
  }

  return (
    <span className={`collection-btn collection-btn--${variant}`}>
      <button
        type="button"
        className={`collection-btn__button${pressed ? ' collection-btn__button--on' : ''}`}
        aria-pressed={pressed}
        aria-label={`${label}: ${name}`}
        aria-busy={busy}
        onClick={onClick}
      >
        <span aria-hidden="true" className="collection-btn__icon">
          {icon}
        </span>
        {variant === 'text' ? <span>{pressed ? pressedText : idleText}</span> : null}
      </button>
      <span className={message ? 'collection-btn__msg collection-btn__msg--on' : 'visually-hidden'} role="status" aria-live="polite">
        {message}
      </span>
    </span>
  );
}
