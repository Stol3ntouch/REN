'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ErrorState, SuccessState } from '@/ui/states';
import { reorderAction } from './actions';
import { REORDER_IDLE } from './form-state';

/** «Повторить заказ»: доступное кладётся в корзину по текущим ценам, пропущенное показано с причиной. */
export function ReorderForm({ number }: { number: string }) {
  const [state, action, pending] = useActionState(reorderAction, REORDER_IDLE);
  return (
    <form action={action} className="account-reorder">
      <input type="hidden" name="number" value={number} />
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? 'Добавляем…' : 'Повторить заказ'}
      </button>
      {state.status === 'success' ? (
        <SuccessState title={state.message ?? 'Готово'}>
          <p>
            <Link href="/cart">Перейти в корзину</Link>
          </p>
        </SuccessState>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState title="Не получилось">
          <p>{state.message}</p>
        </ErrorState>
      ) : null}
      {state.skipped && state.skipped.length > 0 ? (
        <div className="account-reorder__skipped">
          <p>Не добавлено:</p>
          <ul>
            {state.skipped.map((s, i) => (
              <li key={i}>
                «{s.name}» — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
