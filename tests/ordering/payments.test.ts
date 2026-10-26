import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { paymentAdmin, paymentLimitProblem, providerInfo } from '@/domain/ordering/payment-methods';
import { audit } from '@/domain/admin/audit';
import { methodsRepo } from '@/server/db/repositories/methods';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import type { Db } from '@/server/db/connection';
import { admin, manager } from '../admin/helpers';
import { GUEST_A, T0, addProduct, deliveryId, paymentId, setupDb } from './helpers';

const o = (db: Db, extra: Record<string, unknown> = {}) => ({ db, now: T0, env: {}, production: false, ...extra });

function input(over: Record<string, unknown> = {}) {
  return { name: 'Картой курьеру', description: '', enabled: true, sort: 20, feePercentBp: 0, feeFixedKopecks: 0, minKopecks: null, maxKopecks: null, mode: 'live', ...over };
}

const CONTACT = { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33', address: 'Москва, Тверская 1' };
function place(db: Db, payId: number, over: Record<string, unknown> = {}) {
  const c = cart.get(GUEST_A, { db });
  return checkout.place(
    { owner: GUEST_A, cartId: c.cartId, contact: { ...CONTACT }, deliveryMethodId: deliveryId(db, 'pickup'), paymentMethodId: payId, idempotencyKey: `k-${Math.random().toString(36).slice(2)}-abcdefgh`, consent: true, ...over },
    { db, now: T0, secret: 'x'.repeat(40) },
  );
}
function withCart(price: number) {
  const db = setupDb();
  cart.add(GUEST_A, { productId: addProduct(db, { price }), qty: 1 }, { db, now: T0 });
  return db;
}

describe('комиссия и пределы суммы в оформлении', () => {
  it('комиссия = фикс + процент от суммы к оплате, попадает в заказ и итог', async () => {
    const db = withCart(200_000);
    const id = paymentAdmin.create(admin, input({ feePercentBp: 150, feeFixedKopecks: 3_000 }), o(db));
    const order = await place(db, id);
    expect(order.paymentFeeKopecks).toBe(6_000); // 30 ₽ + 1,5 % от 2 000 ₽
    expect(order.totalKopecks).toBe(206_000);
    expect(db.prepare('SELECT payment_fee_kopecks AS f FROM orders WHERE id = ?').get(order.id)).toEqual({ f: 6_000 });
  });

  it('округление комиссии берётся из настроек (вниз/вверх, рубль)', async () => {
    const db = withCart(33_300);
    const id = paymentAdmin.create(admin, input({ feePercentBp: 150 }), o(db));
    db.prepare("INSERT INTO shop_settings (key, value, updated_at) VALUES ('pricing_rounding', 'down', 1), ('pricing_rounding_step', 'kopeck', 1)").run();
    expect((await place(db, id)).paymentFeeKopecks).toBe(499); // 499,5 → вниз
  });

  it('без комиссии итог как раньше', async () => {
    const db = withCart(100_000);
    const order = await place(db, paymentId(db, 'cod'));
    expect(order.paymentFeeKopecks).toBe(0);
    expect(order.totalKopecks).toBe(100_000);
  });

  it('минимум и максимум суммы: вне диапазона способ отклоняется', async () => {
    const db = withCart(100_000);
    const id = paymentAdmin.create(admin, input({ minKopecks: 150_000, maxKopecks: 900_000 }), o(db));
    await expect(place(db, id)).rejects.toMatchObject({ fields: { paymentMethodId: [expect.stringContaining('от')] } });
    const id2 = paymentAdmin.create(admin, input({ name: 'Малый чек', maxKopecks: 50_000 }), o(db));
    await expect(place(db, id2)).rejects.toMatchObject({ fields: { paymentMethodId: [expect.stringContaining('до')] } });
  });

  it('paymentLimitProblem: граничные суммы допустимы', () => {
    const m = { name: 'X', minKopecks: 100, maxKopecks: 200 };
    expect(paymentLimitProblem(m, 100)).toBeNull();
    expect(paymentLimitProblem(m, 200)).toBeNull();
    expect(paymentLimitProblem(m, 99)).not.toBeNull();
    expect(paymentLimitProblem(m, 201)).not.toBeNull();
  });
});

describe('paymentAdmin: настройки, режимы, production', () => {
  it('create — только «при получении»; mode принудительно live', () => {
    const db = setupDb();
    const id = paymentAdmin.create(admin, input({ mode: 'test' }), o(db));
    expect(methodsRepo.findPayment(db, id)).toMatchObject({ kind: 'cash_on_delivery', mode: 'live', testOnly: false });
  });

  it('проверки: проценты, отрицательные суммы, min > max', () => {
    const db = setupDb();
    const bad = (over: Record<string, unknown>) => expect(() => paymentAdmin.create(admin, input(over), o(db))).toThrow(ValidationError);
    bad({ feePercentBp: -1 });
    bad({ feePercentBp: 10_001 });
    bad({ feeFixedKopecks: -1 });
    bad({ minKopecks: 500, maxKopecks: 100 });
    bad({ minKopecks: -1 });
    bad({ name: '' });
    bad({ feePercentBp: 1.5 });
  });

  it('онлайн-метод без провайдера включить нельзя; тестовый — только вне production', () => {
    const db = setupDb();
    methodsRepo.insertOnlineTestIfMissing(db);
    const m = methodsRepo.findPaymentByCode(db, 'online_test')!;
    const on = (opts: Record<string, unknown>) => paymentAdmin.update(admin, m.id, input({ name: m.name, enabled: true, mode: 'test' }), o(db, opts));
    expect(() => on({ production: true })).toThrow(ConflictError);
    expect(() => on({ env: { PAYMENT_PROVIDER: 'yookassa' } })).toThrow(ConflictError); // провайдер выбран, но реализации нет → порт «none»
    on({}); // dev + тестовый провайдер
    expect(methodsRepo.findPayment(db, m.id)).toMatchObject({ enabled: true, mode: 'test' });
  });

  it('в production режим «тестовый» для онлайн-метода запрещён даже при отключённом методе включения', () => {
    const db = setupDb();
    methodsRepo.insertOnlineTestIfMissing(db);
    const m = methodsRepo.findPaymentByCode(db, 'online_test')!;
    expect(() => paymentAdmin.update(admin, m.id, input({ name: m.name, enabled: true, mode: 'live' }), o(db, { production: true }))).toThrow(ConflictError);
  });

  it('последний включённый способ нельзя отключить или удалить; метод с заказами не удаляется', async () => {
    const db = withCart(100_000);
    const cod = paymentId(db, 'cod');
    expect(() => paymentAdmin.update(admin, cod, input({ name: 'Оплата при получении', enabled: false }), o(db))).toThrow(ConflictError);
    expect(() => paymentAdmin.remove(admin, cod, o(db))).toThrow(ConflictError);
    const extra = paymentAdmin.create(admin, input(), o(db));
    await place(db, extra);
    expect(() => paymentAdmin.remove(admin, extra, o(db))).toThrow(ConflictError); // по способу есть заказ
    paymentAdmin.update(admin, extra, input({ enabled: false }), o(db)); // отключить можно: cod остаётся
    expect(methodsRepo.findPayment(db, extra)!.enabled).toBe(false);
  });

  it('аудит пишет изменения без секретов', () => {
    const db = setupDb();
    const id = paymentAdmin.create(admin, input({ feePercentBp: 100 }), o(db, { env: { PAYMENT_API_KEY: 'sk_live_SECRETVALUE' } }));
    paymentAdmin.update(admin, id, input({ feePercentBp: 200 }), o(db));
    const dump = JSON.stringify(audit.list({}, { db }));
    expect(dump).toContain('payment.update');
    expect(dump).not.toContain('SECRETVALUE');
  });

  it('права payments.write: менеджер и аноним отклоняются', () => {
    const db = setupDb();
    expect(() => paymentAdmin.view(manager, o(db))).toThrow(ForbiddenError);
    expect(() => paymentAdmin.create(manager, input(), o(db))).toThrow(ForbiddenError);
    expect(() => paymentAdmin.update(manager, 1, input(), o(db))).toThrow(ForbiddenError);
    expect(() => paymentAdmin.remove(manager, 1, o(db))).toThrow(ForbiddenError);
    expect(() => paymentAdmin.view(null, o(db))).toThrow(UnauthorizedError);
  });
});

describe('секреты платёжного провайдера не покидают сервер', () => {
  const ENV = { PAYMENT_PROVIDER: 'yookassa', PAYMENT_API_KEY: 'sk_live_TOPSECRET_123', PAYMENT_WEBHOOK_SECRET: 'whsec_TOPSECRET_456' };

  it('providerInfo показывает только «задан / не задан»', () => {
    const info = providerInfo({ env: ENV, production: false });
    expect(JSON.stringify(info)).not.toContain('TOPSECRET');
    expect(info.secrets.map((s) => [s.name, s.set])).toEqual([
      ['PAYMENT_API_KEY', true],
      ['PAYMENT_WEBHOOK_SECRET', true],
    ]);
    expect(providerInfo({ env: {}, production: false }).secrets.every((s) => !s.set)).toBe(true);
  });

  it('view не содержит значений секретов ни в каком виде', () => {
    const db = setupDb();
    expect(JSON.stringify(paymentAdmin.view(admin, o(db, { env: ENV })))).not.toContain('TOPSECRET');
  });

  it('в таблицах payment_methods нет колонок для секретов', () => {
    const db = setupDb();
    const cols = (db.prepare('PRAGMA table_info(payment_methods)').all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => /key|secret|token|password/i.test(c))).toEqual([]);
  });
});
