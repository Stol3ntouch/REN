import type { Change } from '@/domain/ordering/types';

/** Состояние форм корзины и оформления для useActionState (тексты на русском). */
export type CartFormState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fields?: Record<string, string[]>;
  /** Список изменений цены/наличия: заказ не создан, пока покупатель не подтвердит. */
  changes?: Change[];
};

export const CART_IDLE: CartFormState = { status: 'idle' };
