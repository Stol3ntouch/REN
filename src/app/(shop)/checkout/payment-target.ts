import { orderAccessPath, startOnlinePayment } from '@/domain/ordering';
import type { Order } from '@/domain/ordering';

/** Параметр страницы заказа: оплату запустить не удалось, оплатить можно позже. */
export const PAYMENT_LATER_PARAM = 'payment=later';

/**
 * Куда вести покупателя после оформления. Заказ уже создан, поэтому любой сбой старта оплаты
 * (таймаут, исключение провайдера) не должен превращаться в ошибку формы: покупатель получает
 * страницу заказа с пояснением, что оплатить можно позже. Причина — в лог без данных заказа.
 */
export async function resolveOrderTarget(order: Order, start: (o: Order) => Promise<{ redirectUrl: string } | null> = startOnlinePayment): Promise<string> {
  const base = order.owner.kind === 'guest' ? orderAccessPath(order.number) : `/order/${encodeURIComponent(order.number)}`;
  const withParams = (params: string) => `${base}${base.includes('?') ? '&' : '?'}${params}`;
  try {
    const payment = await start(order);
    if (payment) return payment.redirectUrl;
    return withParams('placed=1');
  } catch (e) {
    console.error('startOnlinePayment failed:', e instanceof Error ? e.name : 'unknown');
    return withParams(`placed=1&${PAYMENT_LATER_PARAM}`);
  }
}
