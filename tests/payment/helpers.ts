import type { Order } from '@/domain/ordering/types';
import { orders } from '@/domain/ordering/orders';
import { createTestPaymentProvider, signWebhookBody } from '@/integrations/payment/test-provider';
import { SIGNATURE_HEADER, type PaymentPort } from '@/integrations/payment/types';
import type { Db } from '@/server/db/connection';
import { rawOrder, setupDb, T0 } from '../ordering/helpers';

export { T0 };
export const SECRET = 'payment-test-secret-payment-test-secret';
export const SESSION = 'session-secret-session-secret-session-secret';

export function newPort(): PaymentPort {
  return createTestPaymentProvider({ secret: SECRET });
}

/** Заказ в нужном статусе (сумма по умолчанию 1000 ₽); возвращает доменный Order. */
export function makeOrder(db: Db, o: { status?: 'awaiting_payment' | 'cancelled' | 'new'; total?: number; paid?: boolean } = {}): Order {
  const raw = rawOrder(db, o.status ?? 'awaiting_payment', { paid: o.paid });
  if (o.total !== undefined) db.prepare('UPDATE orders SET total_kopecks = ?, subtotal_kopecks = ? WHERE id = ?').run(o.total, o.total, raw.id);
  return orders.getForStaff(raw.number, { db })!;
}

export function freshDb(): Db {
  return setupDb();
}

export type EventOverrides = Partial<{
  eventId: string;
  type: string;
  paymentId: string;
  orderNumber: string;
  amountKopecks: number;
  currency: string;
}>;

/** Подписанное тело webhook как его шлёт провайдер. */
export function signedWebhook(base: { paymentId: string; orderNumber: string; amountKopecks: number }, o: EventOverrides = {}, secret = SECRET): { body: string; headers: Headers } {
  const body = JSON.stringify({
    eventId: o.eventId ?? 'evt_1',
    type: o.type ?? 'payment.succeeded',
    paymentId: o.paymentId ?? base.paymentId,
    orderNumber: o.orderNumber ?? base.orderNumber,
    amountKopecks: o.amountKopecks ?? base.amountKopecks,
    currency: o.currency ?? 'RUB',
    createdAt: T0,
  });
  return { body, headers: new Headers({ [SIGNATURE_HEADER]: signWebhookBody(secret, body) }) };
}
