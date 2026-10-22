import { ORDER_STATUSES, type OrderStatus } from '@/server/db/repositories/orders';

export { ORDER_STATUSES };
export type { OrderStatus };

/**
 * ЕДИНАЯ таблица допустимых переходов статуса заказа (R16). orders.transition не пропускает ничего сверх неё.
 * Дополнительные правила (кто может, оплачен ли заказ) — в orders.ts.
 */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ['awaiting_payment', 'processing', 'cancelled'],
  awaiting_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['awaiting_payment', 'cancelled'],
  paid: ['processing', 'refunded'],
  processing: ['shipped', 'ready_for_pickup', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  ready_for_pickup: ['delivered', 'cancelled', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: 'Новый',
  awaiting_payment: 'Ожидает оплаты',
  paid: 'Оплачен',
  processing: 'В обработке',
  shipped: 'Отправлен',
  ready_for_pickup: 'Готов к выдаче',
  delivered: 'Выдан / доставлен',
  cancelled: 'Отменён',
  payment_failed: 'Ошибка оплаты',
  refunded: 'Возврат средств',
};

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

/** Статусы, которые «Популярность = единицы в неотменённых заказах» (R06.1) не считает. */
export const NOT_COUNTED_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded', 'payment_failed'];
