import { beforeEach, describe, expect, it } from 'vitest';
import { orders } from '@/domain/ordering/orders';
import { setPaymentAutoRegister, setPaymentRefunder } from '@/domain/ordering/payment-flow';
import type { Actor } from '@/domain/ordering/types';
import { getPaymentPort } from '@/integrations';
import { enableTestPaymentMethod, processPaymentWebhook, refundOrderPayment, startPaymentForOrder } from '@/integrations/payment/service';
import { PaymentTimeoutError, type PaymentPort } from '@/integrations/payment/types';
import type { Db } from '@/server/db/connection';
import { methodsRepo } from '@/server/db/repositories/methods';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { SESSION, T0, freshDb, makeOrder, newPort, signedWebhook } from './helpers';

const ADMIN: Actor = { type: 'staff', staffId: 1, role: 'admin' };
let db: Db;
let port: PaymentPort;

beforeEach(() => {
  db = freshDb();
  port = newPort();
  setPaymentAutoRegister(false);
  setPaymentRefunder(null);
});

const start = (order: ReturnType<typeof makeOrder>, p: PaymentPort = port) => startPaymentForOrder(order, { db, port: p, now: T0, secret: SESSION, retryDelayMs: 0, timeoutMs: 30 });

async function paidOrder() {
  const order = makeOrder(db);
  await start(order);
  const pay = paymentsRepo.listForOrder(db, order.id)[0]!;
  const { body, headers } = signedWebhook({ paymentId: pay.externalId, orderNumber: order.number, amountKopecks: 100_000 });
  expect((await processPaymentWebhook(body, headers, { db, port, now: T0 + 1 })).status).toBe(200);
  return { order, pay };
}

describe('старт платежа', () => {
  it('создаёт один платёж и ведёт на /pay/test/<id>; повторный вызов не создаёт дубль', async () => {
    const order = makeOrder(db);
    const a = await start(order);
    const b = await start(order);
    expect(a!.redirectUrl).toMatch(/^\/pay\/test\/tp_[0-9a-f]+\?t=/);
    expect(b).toEqual(a);
    const rows = paymentsRepo.listForOrder(db, order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'test', status: 'pending', amountKopecks: 100_000, currency: 'RUB' });
    expect(rows[0]!.externalId).toMatch(/^tp_/);
  });

  it('таймаут провайдера: заказ остаётся «ожидает оплаты», ошибка записана для оператора, 3 попытки', async () => {
    const order = makeOrder(db);
    let calls = 0;
    const hanging: PaymentPort = { ...port, name: 'test', createPayment: () => ((calls += 1), new Promise(() => {})) } as PaymentPort;
    const res = await start(order, hanging);
    expect(res).toBeNull();
    expect(calls).toBe(3);
    expect(ordersRepo.findById(db, order.id)!.status).toBe('awaiting_payment');
    const errs = paymentsRepo.listErrors(db);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ orderId: order.id, status: 'error', errorCode: 'timeout' });
  });

  it('провайдер недоступен (ошибка): тоже записывается, без секретов в сообщении', async () => {
    const order = makeOrder(db);
    const broken: PaymentPort = { ...port, createPayment: async () => { throw new Error('connect ECONNREFUSED'); } } as PaymentPort;
    expect(await start(order, broken)).toBeNull();
    expect(paymentsRepo.listErrors(db)[0]).toMatchObject({ errorCode: 'unavailable' });
    expect(ordersRepo.findById(db, order.id)!.status).toBe('awaiting_payment');
    void PaymentTimeoutError;
  });

  it('после отказа повторная оплата: новый платёж, заказ снова «ожидает оплаты»', async () => {
    const order = makeOrder(db);
    await start(order);
    const first = paymentsRepo.listForOrder(db, order.id)[0]!;
    const { body, headers } = signedWebhook({ paymentId: first.externalId, orderNumber: order.number, amountKopecks: 100_000 }, { type: 'payment.failed' });
    await processPaymentWebhook(body, headers, { db, port, now: T0 + 1 });
    expect(ordersRepo.findById(db, order.id)!.status).toBe('payment_failed');
    const retry = await start(orders.getForStaff(order.number, { db })!);
    expect(retry).not.toBeNull();
    expect(ordersRepo.findById(db, order.id)!.status).toBe('awaiting_payment');
    expect(paymentsRepo.listForOrder(db, order.id)).toHaveLength(2);
  });

  it('заказ не в ожидании оплаты (отменён) → платёж не создаётся', async () => {
    const order = makeOrder(db, { status: 'cancelled' });
    expect(await start(order)).toBeNull();
    expect(paymentsRepo.listForOrder(db, order.id)).toHaveLength(0);
  });

  it('итог 0 ₽ (промокод 100%): платёж не создаётся, заказ проводится как оплаченный системой без платежа', async () => {
    const order = makeOrder(db, { total: 0 });
    expect(await start(order)).toBeNull();
    expect(paymentsRepo.listForOrder(db, order.id)).toHaveLength(0);
    expect(ordersRepo.findById(db, order.id)!.status).toBe('paid');
    expect(ordersRepo.listEvents(db, order.id).find((e) => e.toStatus === 'paid')).toMatchObject({ actorType: 'system', actorId: 'zero_total' });
  });
});

describe('возврат', () => {
  it('orders.refund → возврат у провайдера → заказ «возвращён», платёж refunded', async () => {
    const { order, pay } = await paidOrder();
    const calls: Array<[string, number, string | undefined]> = [];
    const spy: PaymentPort = { ...port, refund: async (id, amount, o) => void calls.push([id, amount, o?.idempotencyKey]) } as PaymentPort;
    setPaymentRefunder((o, ctx) => refundOrderPayment(o, ctx, { db, port: spy, now: T0 + 2 }));
    const res = await orders.refund(order.id, ADMIN, 'по просьбе', { db, now: T0 + 3 });
    expect(res.status).toBe('refunded');
    expect(res.isPaid).toBe(false);
    expect(calls).toEqual([[pay.externalId, 100_000, `refund:${order.id}`]]);
    expect(paymentsRepo.findById(db, pay.id)).toMatchObject({ status: 'refunded', refundedKopecks: 100_000 });
  });

  it('два параллельных клика: провайдеру уходит один возврат, второй получает 409', async () => {
    const { order } = await paidOrder();
    let calls = 0;
    const spy: PaymentPort = { ...port, refund: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); } } as PaymentPort;
    setPaymentRefunder((o, ctx) => refundOrderPayment(o, ctx, { db, port: spy, now: T0 + 2 }));
    const results = await Promise.allSettled([orders.refund(order.id, ADMIN, undefined, { db }), orders.refund(order.id, ADMIN, undefined, { db })]);
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(ordersRepo.findById(db, order.id)!.status).toBe('refunded');
  });

  it('сбой провайдера при возврате: платёж снова succeeded, заказ остаётся оплаченным, можно повторить', async () => {
    const { order, pay } = await paidOrder();
    const broken: PaymentPort = { ...port, refund: async () => { throw new Error('boom'); } } as PaymentPort;
    setPaymentRefunder((o, ctx) => refundOrderPayment(o, ctx, { db, port: broken }));
    await expect(orders.refund(order.id, ADMIN, undefined, { db })).rejects.toThrow();
    expect(paymentsRepo.findById(db, pay.id)!.status).toBe('succeeded');
    expect(ordersRepo.findById(db, order.id)!.isPaid).toBe(true);
  });

  it('менеджер вернуть не может; возврат неоплаченного — 409', async () => {
    const { order } = await paidOrder();
    setPaymentRefunder((o, ctx) => refundOrderPayment(o, ctx, { db, port }));
    await expect(orders.refund(order.id, { type: 'staff', staffId: 2, role: 'manager' }, undefined, { db })).rejects.toMatchObject({ status: 403 });
    const unpaid = makeOrder(db);
    await expect(orders.refund(unpaid.id, ADMIN, undefined, { db })).rejects.toMatchObject({ status: 409 });
  });
});

describe('production и тестовый провайдер', () => {
  it('в production без выбранного провайдера: порт «не подключён», платёж не создаётся, вебхуков нет', async () => {
    const prod = getPaymentPort({ production: true, env: {} });
    expect(prod.name).not.toBe('test');
    expect(prod.status()).toMatchObject({ connected: false, mode: 'stub' });
    await expect(prod.createPayment({ orderNumber: 'RTS-000001', amountKopecks: 100, returnUrl: '/x' })).rejects.toBeTruthy();
    const { body, headers } = signedWebhook({ paymentId: 'tp_1', orderNumber: 'RTS-000001', amountKopecks: 100 });
    expect(prod.verifyWebhook(body, headers)).toBeNull();
  });

  it('PAYMENT_PROVIDER=test в production всё равно не включает тестовый провайдер', () => {
    expect(getPaymentPort({ production: true, env: { PAYMENT_PROVIDER: 'test' } }).name).not.toBe('test');
  });

  it('вне production выбирается тестовый провайдер', () => {
    expect(getPaymentPort({ production: false, env: {} }).name).toBe('test');
  });

  it('online_test включается вне production и только при тестовом провайдере', () => {
    methodsRepo.insertOnlineTestIfMissing(db);
    expect(() => enableTestPaymentMethod(db, { production: true, port })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(methodsRepo.findPaymentByCode(db, 'online_test')!.enabled).toBe(false);
    const prod = getPaymentPort({ production: true, env: {} });
    expect(() => enableTestPaymentMethod(db, { production: false, port: prod })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(methodsRepo.findPaymentByCode(db, 'online_test')!.enabled).toBe(false);
    enableTestPaymentMethod(db, { production: false, port });
    expect(methodsRepo.findPaymentByCode(db, 'online_test')!.enabled).toBe(true);
  });
});
