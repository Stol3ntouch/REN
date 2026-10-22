import { beforeEach, describe, expect, it } from 'vitest';
import { orders } from '@/domain/ordering/orders';
import { processPaymentWebhook, startPaymentForOrder } from '@/integrations/payment/service';
import type { PaymentPort } from '@/integrations/payment/types';
import type { Db } from '@/server/db/connection';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { webhookEventsRepo } from '@/server/db/repositories/webhook-events';
import { SECRET, SESSION, T0, freshDb, makeOrder, newPort, signedWebhook, type EventOverrides } from './helpers';

let db: Db;
let port: PaymentPort;

beforeEach(() => {
  db = freshDb();
  port = newPort();
});

/** Заказ с созданным платежом — как после оформления «онлайн (ТЕСТ)». */
async function started(total = 100_000) {
  const order = makeOrder(db, { total });
  const res = await startPaymentForOrder(order, { db, port, now: T0, secret: SESSION });
  expect(res).not.toBeNull();
  const pay = paymentsRepo.listForOrder(db, order.id)[0]!;
  return { order, pay, base: { paymentId: pay.externalId, orderNumber: order.number, amountKopecks: total } };
}

const send = (base: { paymentId: string; orderNumber: string; amountKopecks: number }, o: EventOverrides = {}, secret = SECRET) => {
  const { body, headers } = signedWebhook(base, o, secret);
  return processPaymentWebhook(body, headers, { db, port, now: T0 + 5_000 });
};
const statusOf = (id: number) => ordersRepo.findById(db, id)!.status;

describe('webhook: успех и отказ', () => {
  it('успех → заказ «оплачен» (система, webhook:<id>), платёж succeeded, событие обработано', async () => {
    const { order, base } = await started();
    const res = await send(base);
    expect(res.status).toBe(200);
    const row = ordersRepo.findById(db, order.id)!;
    expect(row.status).toBe('paid');
    expect(row.isPaid).toBe(true);
    const ev = ordersRepo.listEvents(db, order.id).find((e) => e.toStatus === 'paid')!;
    expect(ev).toMatchObject({ actorType: 'system', actorId: 'webhook:evt_1' });
    expect(paymentsRepo.listForOrder(db, order.id)[0]!.status).toBe('succeeded');
    expect(webhookEventsRepo.find(db, 'test', 'evt_1')!.outcome).toBe('processed');
  });

  it('отказ → «ошибка оплаты», платёж failed', async () => {
    const { order, base } = await started();
    const res = await send(base, { type: 'payment.failed' });
    expect(res.status).toBe(200);
    expect(statusOf(order.id)).toBe('payment_failed');
    expect(paymentsRepo.listForOrder(db, order.id)[0]!.status).toBe('failed');
  });

  it('повтор того же event id: 200, заказ и платёж не меняются повторно', async () => {
    const { order, base } = await started();
    expect((await send(base)).status).toBe(200);
    const eventsAfterFirst = ordersRepo.listEvents(db, order.id).length;
    const again = await send(base);
    expect(again.status).toBe(200);
    expect(again.body.result).toBe('duplicate');
    expect(ordersRepo.listEvents(db, order.id)).toHaveLength(eventsAfterFirst);
    expect(ordersRepo.listEvents(db, order.id).filter((e) => e.toStatus === 'paid')).toHaveLength(1);
    expect(paymentsRepo.listForOrder(db, order.id)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get()).toMatchObject({ n: 1 });
  });

  it('другое событие по уже оплаченному платежу не переводит заказ повторно', async () => {
    const { order, base } = await started();
    await send(base, { eventId: 'evt_a' });
    const n = ordersRepo.listEvents(db, order.id).length;
    const res = await send(base, { eventId: 'evt_b' });
    expect(res.status).toBe(200);
    expect(ordersRepo.listEvents(db, order.id)).toHaveLength(n);
    expect(webhookEventsRepo.find(db, 'test', 'evt_b')!.outcome).toBe('ignored');
  });
});

describe('webhook: отклонение (заказ не меняется)', () => {
  it('неверная подпись → 401', async () => {
    const { order, base } = await started();
    const res = await send(base, {}, 'чужой-секрет-чужой-секрет-чужой-секрет');
    expect(res.status).toBe(401);
    expect(statusOf(order.id)).toBe('awaiting_payment');
    expect(db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get()).toMatchObject({ n: 0 });
  });

  it('неизвестный заказ → 400', async () => {
    const { order, base } = await started();
    const res = await send(base, { orderNumber: 'RTS-999999' });
    expect(res.status).toBe(400);
    expect(statusOf(order.id)).toBe('awaiting_payment');
  });

  it('неизвестный платёж → 400', async () => {
    const { order, base } = await started();
    expect((await send(base, { paymentId: 'tp_нет_такого' })).status).toBe(400);
    expect(statusOf(order.id)).toBe('awaiting_payment');
  });

  it('платёж другого заказа → 400', async () => {
    const { base } = await started();
    const other = makeOrder(db);
    const res = await send(base, { orderNumber: other.number });
    expect(res.status).toBe(400);
    expect(statusOf(other.id)).toBe('awaiting_payment');
  });

  it('сумма не как в заказе → 400', async () => {
    const { order, base } = await started();
    const res = await send(base, { amountKopecks: 100 });
    expect(res.status).toBe(400);
    expect(statusOf(order.id)).toBe('awaiting_payment');
    expect(paymentsRepo.listForOrder(db, order.id)[0]!.status).toBe('pending');
  });

  it('валюта не как в заказе → отклонено, заказ не меняется', async () => {
    const { order, base } = await started();
    const res = await send(base, { currency: 'USD' });
    expect([400, 401]).toContain(res.status);
    expect(statusOf(order.id)).toBe('awaiting_payment');
  });

  it('слишком большое тело → 400', async () => {
    const res = await processPaymentWebhook('x'.repeat(100_000), new Headers(), { db, port });
    expect(res.status).toBe(400);
  });

  it('секрет не попадает в ответ', async () => {
    const { base } = await started();
    const ok = JSON.stringify((await send(base)).body);
    const bad = JSON.stringify((await send(base, {}, 'x-секрет-секрет-секрет-секрет-секрет-1')).body);
    expect(ok + bad).not.toContain(SECRET);
  });
});

describe('webhook: оплата по заказу, который уже нельзя оплатить', () => {
  it('оплата по отменённому заказу: заказ не меняется, событие — алерт для оператора, ответ 200', async () => {
    const { order, base } = await started();
    await orders.transition(order.id, 'cancelled', { type: 'system', reason: 'test' }, undefined, { db, now: T0 + 1 });
    const res = await send(base);
    expect(res.status).toBe(200);
    expect(statusOf(order.id)).toBe('cancelled');
    expect(ordersRepo.findById(db, order.id)!.isPaid).toBe(false);
    const ev = webhookEventsRepo.find(db, 'test', 'evt_1')!;
    expect(ev.outcome).toBe('alert');
    expect(ev.detail).toContain('нужен возврат');
    expect(webhookEventsRepo.listAttention(db)).toHaveLength(1);
    expect(paymentsRepo.listForOrder(db, order.id)[0]!.status).toBe('succeeded');
  });
});

describe('возврат браузера не ставит «оплачен»', () => {
  it('после создания платежа и возврата на returnUrl (без webhook) заказ остаётся «ожидает оплаты»', async () => {
    const { order, pay } = await started();
    expect(pay.returnUrl).toMatch(/^\/order\/RTS-/);
    expect(statusOf(order.id)).toBe('awaiting_payment');
    expect(ordersRepo.findById(db, order.id)!.isPaid).toBe(false);
    // и вручную «оплачен» поставить нельзя ни сотруднику, ни покупателю
    await expect(orders.transition(order.id, 'paid', { type: 'staff', staffId: 1, role: 'admin' }, undefined, { db })).rejects.toMatchObject({ status: 403 });
    await expect(orders.transition(order.id, 'paid', { type: 'customer', owner: order.owner }, undefined, { db })).rejects.toMatchObject({ status: 403 });
  });
});
