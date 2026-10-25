import { ORDER_STATUSES, type OrderStatus } from '@/server/db/repositories/orders';

export { ORDER_STATUSES };
export type { OrderStatus };

/**
 * ЕДИНАЯ таблица допустимых переходов статуса заказа (R16). orders.transition не пропускает ничего сверх неё.
 * Дополнительные правила (кто может, оплачен ли заказ) — в orders.ts.
 *
 * Бизнес-процесс: Новый → Подтверждён → Собирается → Передан в доставку / Готов к выдаче → Выполнен; Отменён.
 * Технические статусы онлайн-оплаты (awaiting_payment, paid, payment_failed, refunded) сохранены: их ставит только
 * проверенный webhook или возврат средств. Сопоставление старых кодов новым названиям — docs/adr/0008.
 */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ['confirmed', 'awaiting_payment', 'processing', 'cancelled'],
  confirmed: ['processing', 'cancelled', 'refunded'],
  awaiting_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['awaiting_payment', 'cancelled'],
  paid: ['confirmed', 'processing', 'refunded'],
  processing: ['shipped', 'ready_for_pickup', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  ready_for_pickup: ['delivered', 'cancelled', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/**
 * ЯВНАЯ таблица возврата на предыдущий шаг (исправление ошибки). Только вместе с причиной; история не стирается —
 * в журнал пишется событие «revert». «Выполнен» и «Отменён» возвращаются только правом orders.refund (см. PRIVILEGED_REVERT_FROM).
 * Статусы оплаты и «возврат средств» назад не идут: деньги уже двигались.
 */
export const REVERSE_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: [],
  confirmed: ['new'],
  awaiting_payment: [],
  payment_failed: [],
  paid: [],
  processing: ['confirmed'],
  shipped: ['processing'],
  ready_for_pickup: ['processing'],
  delivered: ['shipped', 'ready_for_pickup'],
  cancelled: ['new', 'awaiting_payment'],
  refunded: [],
};

/** Возврат из этих статусов требует права orders.refund (администратор). */
export const PRIVILEGED_REVERT_FROM: readonly OrderStatus[] = ['delivered', 'cancelled'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function canRevert(from: OrderStatus, to: OrderStatus): boolean {
  return REVERSE_TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  awaiting_payment: 'Ожидает оплаты',
  paid: 'Оплачен',
  processing: 'Собирается',
  shipped: 'Передан в доставку',
  ready_for_pickup: 'Готов к выдаче',
  delivered: 'Выполнен',
  cancelled: 'Отменён',
  payment_failed: 'Ошибка оплаты',
  refunded: 'Возврат средств',
};

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

/** Статусы, которые «Популярность = единицы в неотменённых заказах» (R06.1) не считает. */
export const NOT_COUNTED_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded', 'payment_failed'];

/** Состав и суммы можно менять только до передачи в доставку. */
export const ITEMS_EDITABLE_STATUSES: readonly OrderStatus[] = ['new', 'confirmed', 'awaiting_payment', 'payment_failed', 'paid', 'processing'];

/** Контакты и адрес можно править, пока заказ не завершён и не отменён. */
export const CONTACT_EDITABLE_STATUSES: readonly OrderStatus[] = ['new', 'confirmed', 'awaiting_payment', 'payment_failed', 'paid', 'processing', 'shipped', 'ready_for_pickup'];
