'use client';

import { useActionState } from 'react';
import { CART_IDLE } from '@/ui/cart/state';
import { ErrorState, SuccessState } from '@/ui/states';
import { applyPromoAction, removePromoAction } from './actions';

/** Промокод: один на заказ; ошибка показывается текстом, корзина не меняется. */
export function PromoForm({ appliedCode }: { appliedCode: string | null }) {
  const [state, action, pending] = useActionState(applyPromoAction, CART_IDLE);

  if (appliedCode) {
    return (
      <div className="promo-form">
        <p className="summary__hint">Применён промокод {appliedCode}.</p>
        <form action={removePromoAction}>
          <button type="submit" className="button button--outline">
            Убрать промокод
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="promo-form">
      <label htmlFor="promo-code">Промокод</label>
      <div className="promo-form__row">
        <input id="promo-code" name="code" type="text" autoComplete="off" maxLength={64} required />
        <button type="submit" className="button button--outline" disabled={pending}>
          {pending ? 'Проверяем…' : 'Применить'}
        </button>
      </div>
      {state.status === 'error' && state.message ? (
        <ErrorState title="Промокод не применён">
          <p>{state.message}</p>
        </ErrorState>
      ) : null}
      {state.status === 'success' && state.message ? (
        <SuccessState title="Готово">
          <p>{state.message}</p>
        </SuccessState>
      ) : null}
    </form>
  );
}
