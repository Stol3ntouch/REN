import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleWebhookRequest } from '@/integrations/payment/webhook-http';
import { setPaymentRunLogger, startPaymentForOrder, type PaymentRunEntry } from '@/integrations/payment/service';
import type { PaymentPort } from '@/integrations/payment/types';
import type { Db } from '@/server/db/connection';
import { ordersRepo } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { SESSION, T0, freshDb, makeOrder, newPort, signedWebhook } from '../payment/helpers';

let db: Db;
let port: PaymentPort;
let log: PaymentRunEntry[];

beforeEach(() => {
  db = freshDb();
  port = newPort();
  log = [];
  setPaymentRunLogger((e) => log.push(e));
});
afterEach(() => setPaymentRunLogger(null));

const URL_ = 'http://shop.test/api/payment/webhook';
const deps = (ip = '203.0.113.7') => ({ db, port, now: T0 + 5_000, ip });

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_, { method: 'POST', body, headers });
}

function chunked(chunks: number, size: number, extra: Record<string, string> = {}): { req: Request; pulled: () => number } {
  let n = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (n >= chunks) return c.close();
      n += 1;
      c.enqueue(new Uint8Array(size).fill(97));
    },
  });
  const req = new Request(URL_, { method: 'POST', body: stream, duplex: 'half', headers: extra } as RequestInit);
  return { req, pulled: () => n };
}

describe('webhook: размер тела', () => {
  it('content-length больше 64 КБ → 413, тело не читается', async () => {
    const { req, pulled } = chunked(10, 10_000, { 'content-length': '100000' });
    const res = await handleWebhookRequest(req, deps());
    expect(res.status).toBe(413);
    expect(pulled()).toBeLessThanOrEqual(1); // undici сам предзачитывает один фрагмент при создании Request; handler не читает
  });

  it('заголовок занижен/нет, а тело фактически больше → 413, читается не всё', async () => {
    const { req, pulled } = chunked(1000, 1024); // 1 МБ без content-length
    const res = await handleWebhookRequest(req, deps());
    expect(res.status).toBe(413);
    expect(pulled()).toBeLessThan(100);
  });

  it('тело в пределах лимита обрабатывается как раньше (неверная подпись → 401)', async () => {
    const res = await handleWebhookRequest(post('{"x":1}'), deps());
    expect(res.status).toBe(401);
  });
});

describe('webhook: лимит неудач по IP и журнал', () => {
  it('после 20 неудач с одного IP запросы получают 429, другой IP не затронут', async () => {
    for (let i = 0; i < 20; i++) expect((await handleWebhookRequest(post('{"bad":true}'), deps())).status).toBe(401);
    const blocked = await handleWebhookRequest(post('{"bad":true}'), deps());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await handleWebhookRequest(post('{"bad":true}'), deps('198.51.100.9'))).status).toBe(401);
  });

  it('400 (неизвестный платёж) тоже считается', async () => {
    const order = makeOrder(db);
    await startPaymentForOrder(order, { db, port, now: T0, secret: SESSION });
    const { body, headers } = signedWebhook({ paymentId: 'tp_unknown', orderNumber: order.number, amountKopecks: 100_000 });
    for (let i = 0; i < 20; i++) expect((await handleWebhookRequest(post(body, Object.fromEntries(headers)), deps())).status).toBe(400);
    expect((await handleWebhookRequest(post(body, Object.fromEntries(headers)), deps())).status).toBe(429);
  });

  it('успешные события не расходуют лимит', async () => {
    const order = makeOrder(db);
    await startPaymentForOrder(order, { db, port, now: T0, secret: SESSION });
    const pay = paymentsRepo.listForOrder(db, order.id)[0]!;
    const { body, headers } = signedWebhook({ paymentId: pay.externalId, orderNumber: order.number, amountKopecks: 100_000 });
    for (let i = 0; i < 25; i++) expect((await handleWebhookRequest(post(body, Object.fromEntries(headers)), deps())).status).toBe(200);
    expect(ordersRepo.findById(db, order.id)!.status).toBe('paid');
  });

  it('IP неизвестен (нет доверенного прокси): общий бакет не создаётся, события не блокируются', async () => {
    for (let i = 0; i < 30; i++) expect((await handleWebhookRequest(post('{"bad":true}'), deps('unknown'))).status).toBe(401);
  });

  it('причина отказа пишется в журнал без тела запроса', async () => {
    await handleWebhookRequest(post('{"marker":"SECRET-BODY-MARKER"}'), deps());
    await handleWebhookRequest(chunked(1000, 1024).req, deps());
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.every((e) => e.kind === 'webhook' && e.ok === false)).toBe(true);
    expect(log.map((e) => e.code)).toEqual(expect.arrayContaining(['rejected_401', 'too_large']));
    expect(JSON.stringify(log)).not.toContain('SECRET-BODY-MARKER');
  });
});
