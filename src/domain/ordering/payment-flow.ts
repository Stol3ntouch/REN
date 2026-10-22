import type { Order } from './types';

/**
 * Шов для T06 (онлайн-оплата). T05 ничего не знает о провайдере:
 *  - после checkout.place() для способа оплаты kind='online' интерфейс вызывает startOnlinePayment(order);
 *    T06 регистрирует через setPaymentStarter функцию, которая создаёт платёж (PaymentPort.createPayment)
 *    и возвращает redirectUrl; нет стартера → null, заказ остаётся в «ожидает оплаты» (или «новый»).
 *  - «Оплачен» / «ошибка оплаты» T06 ставит ТОЛЬКО по проверенному webhook:
 *      orders.transition(orderId, 'paid' | 'payment_failed', { type: 'system', reason: 'webhook:<eventId>' }).
 *  - возврат (admin): orders.refund() вызывает зарегистрированный setPaymentRefunder (PaymentPort.refund),
 *    затем переводит заказ в «refunded». Нет возвратчика → ConflictError.
 */
export type PaymentStarter = (order: Order) => Promise<{ redirectUrl: string } | null>;
export type PaymentRefunder = (order: Order) => Promise<void>;

let starter: PaymentStarter | null = null;
let refunder: PaymentRefunder | null = null;

export function setPaymentStarter(impl: PaymentStarter | null): void {
  starter = impl;
}
export function setPaymentRefunder(impl: PaymentRefunder | null): void {
  refunder = impl;
}

export async function startOnlinePayment(order: Order): Promise<{ redirectUrl: string } | null> {
  if (order.payment.kind !== 'online' || !starter) return null;
  return starter(order);
}

export function getPaymentRefunder(): PaymentRefunder | null {
  return refunder;
}
