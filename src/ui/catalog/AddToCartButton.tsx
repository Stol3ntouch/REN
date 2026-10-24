'use client';

import { useId, useState } from 'react';
import { addToCart, MAX_QTY_PER_ITEM } from './add-to-cart';

type Status = 'idle' | 'loading' | 'success' | 'error';

/** «В корзину»: нет в наличии — кнопка отключена с пояснением; сервер всё равно перепроверяет наличие. */
export function AddToCartButton({
  productId,
  inStock,
  name,
  compact = false,
  withQuantity = false,
}: {
  productId: number;
  inStock: boolean;
  name: string;
  compact?: boolean;
  withQuantity?: boolean;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [qty, setQty] = useState(1);

  if (!inStock) {
    return (
      <div className="add-to-cart">
        <button type="button" className="button add-to-cart__button" disabled aria-describedby={`${id}-note`}>
          {compact ? 'Нет в наличии' : 'В корзину'}
        </button>
        {/* в карточке списка причина — в самой кнопке, а пояснение скрыто: так карточки остаются одной высоты */}
        <p id={`${id}-note`} className={compact ? 'visually-hidden' : 'add-to-cart__note'}>
          Нет в наличии — добавить в корзину нельзя
        </p>
      </div>
    );
  }

  async function onClick() {
    if (status === 'loading') return;
    setStatus('loading');
    const res = await addToCart(productId, qty);
    if (res.ok) {
      setStatus('success');
      setMessage('Добавлено в корзину');
    } else {
      setStatus('error');
      setMessage(res.message);
    }
  }

  return (
    <div className={`add-to-cart${compact ? ' add-to-cart--compact' : ''}`}>
      <div className="add-to-cart__row">
        {withQuantity ? (
          <label className="add-to-cart__qty">
            <span className="visually-hidden">Количество</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_QTY_PER_ITEM}
              value={qty}
              onChange={(e) => setQty(Math.min(MAX_QTY_PER_ITEM, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="button add-to-cart__button"
          onClick={onClick}
          disabled={status === 'loading'}
          aria-label={`В корзину: ${name}`}
          aria-busy={status === 'loading'}
        >
          {status === 'loading' ? 'Добавляем…' : 'В корзину'}
        </button>
      </div>
      <p className={`add-to-cart__status${status === 'error' ? ' add-to-cart__status--error' : ''}`} role="status" aria-live="polite">
        {status === 'success' || status === 'error' ? message : ''}
      </p>
    </div>
  );
}
