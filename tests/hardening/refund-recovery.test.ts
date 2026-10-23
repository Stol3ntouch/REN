import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orders } from '@/domain/ordering/orders';
import { setPaymentAutoRegister, setPaymentRefunder } from '@/domain/ordering/payment-flow';
import type { Actor } from '@/domain/ordering/types';
import { processPaymentWebhook, reconcileStaleRefunds, refundOrderPayment, startPaymentForOrder } from '@/integrations/payment/service';
import type { PaymentPort } from '@/integrations/payment/types';
import type { Db } from '@/server/db/connection';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { SESSION, T0, freshDb, makeOrder, newPort, signedWebhook } from '../payment/helpers';

const ADMIN: Actor = { type: 'staff', staffId: 1, role: 'admin' };
let db: Db;
let port: PaymentPort;

beforeEach(() => {
  db = freshDb();
  port = newPort();
  setPaymentAutoRegister(false);
  setPaymentRefunder(null);
});

async function paidOrder() {
  const order = makeOrder(db);
  await startPaymentForOrder(order, { db, port, now: T0, secret: SESSION, retryDelayMs: 0, timeoutMs: 30 });
  const pay = paymentsRepo.listForOrder(db, order.id)[0]!;
  const { body, headers } = signedWebhook({ paymentId: pay.externalId, orderNumber: order.number, amountKopecks: 100_000 });
  await processPaymentWebhook(body, headers, { db, port, now: T0 + 1 });
  return { order, pay };
}

const counting = () => {
  const calls: Array<[string, number, string | undefined]> = [];
  const spy: PaymentPort = { ...port, refund: async (id, amount, o) => void calls.push([id, amount, o?.idempotencyKey]) } as PaymentPort;
  return { calls, spy };
};

describe('возврат не зависает', () => {
  it('сбой transition после возврата у провайдера: повторный возврат только завершает заказ, провайдера не зовёт', async () => {
    const { order, pay } = await paidOrder();
    const { calls, spy } = counting();
    setPaymentRefunder((o, ctx) => refundOrderPayment(o, ctx, { db, port: spy, now: T0 + 2 }));

    const failing = vi.spyOn(orders, 'transition').mockRejectedValueOnce(new Error('db is locked'));
    await expect(orders.refund(order.id, ADMIN, undefined, { db, now: T0 + 3 })).rejects.toThrow('db is locked');
    failing.mockRestore();
    expect(paymentsRepo.findById(db, pay.id)!.status).toBe('refunded');
    expect(ordersRepo.findById(db, order.id)).toMatchObject({ status: 'paid', isPaid: true });

    const res = await orders.refund(order.id, ADMIN, undefined, { db, now: T0 + 4 });
    expect(res).toMatchObject({ status: 'refunded', isPaid: false });
    expect(calls).toHaveLength(1); // второй вызов провайдера не уходил
  });

  it('refundOrderPayment по уже возвращённому платежу не обращается к провайдеру и не бросает', async () => {
    const { order, pay } = await paidOrder();
    paymentsRepo.transition(db, pay.id, ['succeeded'], 'refunded', T0 + 2, { refundedKopecks: pay.amountKopecks });
    const { calls, spy } = counting();
    await expect(refundOrderPayment(orders.getForStaff(order.number, { db })!, { idempotencyKey: `refund:${order.id}` }, { db, port: spy, now: T0 + 3 })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('платёж в refund_pending старше таймаута подбирается: повторный возврат уходит с тем же ключом', async () => {
    const { order, pay } = await paidOrder();
    paymentsRepo.transition(db, pay.id, ['succeeded'], 'refund_pending', T0 + 2); // процесс упал после резервирования
    const { calls, spy } = counting();
    const o = orders.getForStaff(order.number, { db })!;
    // свежий refund_pending — другой клик ещё идёт: отказ
    await expect(refundOrderPayment(o, { idempotencyKey: `refund:${order.id}` }, { db, port: spy, now: T0 + 3 })).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(0);
    // старше таймаута — подбирается
    await refundOrderPayment(o, { idempotencyKey: `refund:${order.id}` }, { db, port: spy, now: T0 + 10 * 60_000 });
    expect(calls).toEqual([[pay.externalId, 100_000, `refund:${order.id}`]]);
    expect(paymentsRepo.findById(db, pay.id)!.status).toBe('refunded');
  });

  it('reconcileStaleRefunds доводит зависший возврат и заказ до refunded', async () => {
    const { order, pay } = await paidOrder();
    paymentsRepo.transition(db, pay.id, ['succeeded'], 'refund_pending', T0 + 2);
    const { calls, spy } = counting();
    const early = await reconcileStaleRefunds({ db, port: spy, now: T0 + 3 });
    expect(early).toEqual({ checked: 0, completed: 0, failed: 0 });
    const done = await reconcileStaleRefunds({ db, port: spy, now: T0 + 10 * 60_000 });
    expect(done).toEqual({ checked: 1, completed: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(ordersRepo.findById(db, order.id)).toMatchObject({ status: 'refunded', isPaid: false });
    expect(paymentsRepo.findById(db, pay.id)!.status).toBe('refunded');
  });

  it('сбой провайдера при подборе зависшего возврата оставляет refund_pending для следующей попытки', async () => {
    const { order, pay } = await paidOrder();
    paymentsRepo.transition(db, pay.id, ['succeeded'], 'refund_pending', T0 + 2);
    const broken: PaymentPort = { ...port, refund: async () => { throw new Error('boom'); } } as PaymentPort;
    const res = await reconcileStaleRefunds({ db, port: broken, now: T0 + 10 * 60_000 });
    expect(res).toEqual({ checked: 1, completed: 0, failed: 1 });
    expect(paymentsRepo.findById(db, pay.id)!.status).toBe('refund_pending');
    expect(ordersRepo.findById(db, order.id)!.status).toBe('paid');
  });
});
