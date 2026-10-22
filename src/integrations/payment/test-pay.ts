import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { resolveOwner } from '@/domain/customers/session';
import { orders } from '@/domain/ordering/orders';
import type { Order } from '@/domain/ordering/types';
import { getDb } from '@/server/db/connection';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo, type PaymentRow } from '@/server/db/repositories/payments';
import { getPaymentPort, resolveWebhookSecret } from './select';
import { signWebhookBody } from './test-provider';
import { SIGNATURE_HEADER } from './types';
import { processPaymentWebhook } from './service';

export type TestPayContext = { payment: PaymentRow; order: Order };

/**
 * Страница/действие тестовой оплаты: платёж и заказ видны только владельцу заказа или тому, у кого подписанная
 * ссылка (?t=). Чужое, несуществующее и «тестовый провайдер выключен» — одинаково null (страница отвечает 404).
 */
export async function loadTestPayment(externalId: string, token: string | null): Promise<TestPayContext | null> {
  const port = getPaymentPort();
  if (port.name !== 'test') return null;
  const db = getDb();
  const payment = paymentsRepo.findByExternalId(db, 'test', externalId);
  if (!payment) return null;
  const row = ordersRepo.findById(db, payment.orderId);
  if (!row) return null;
  const owner = resolveOwner(await cookies());
  const order = orders.getForCustomer(row.number, owner) ?? orders.getByGuestToken(row.number, token);
  return order ? { payment, order } : null;
}

/** Подписывает событие и пропускает его через тот же обработчик, что и POST /api/payment/webhook. */
export async function sendTestWebhook(ctx: TestPayContext, outcome: 'success' | 'failure'): Promise<{ status: number }> {
  const body = JSON.stringify({
    eventId: `evt_${randomUUID()}`,
    type: outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
    paymentId: ctx.payment.externalId,
    orderNumber: ctx.order.number,
    amountKopecks: ctx.payment.amountKopecks,
    currency: ctx.payment.currency,
    createdAt: Date.now(),
  });
  const headers = new Headers({ [SIGNATURE_HEADER]: signWebhookBody(resolveWebhookSecret(), body) });
  const res = await processPaymentWebhook(body, headers);
  return { status: res.status };
}
