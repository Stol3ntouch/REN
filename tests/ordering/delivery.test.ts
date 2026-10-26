import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { addressInRegions, deliveryAdmin, normalizePlace, quoteDelivery } from '@/domain/ordering/delivery';
import { audit } from '@/domain/admin/audit';
import { methodsRepo, type DeliveryMethodRow } from '@/server/db/repositories/methods';
import { ForbiddenError, UnauthorizedError, ValidationError, ConflictError } from '@/server/http/errors';
import type { Db } from '@/server/db/connection';
import { admin, manager } from '../admin/helpers';
import { GUEST_A, T0, addProduct, deliveryId, paymentId, setupDb } from './helpers';

const base: DeliveryMethodRow = {
  id: 1,
  code: 'c',
  name: 'Курьер',
  description: null,
  kind: 'manual',
  priceKopecks: 50_000,
  requiresAddress: true,
  enabled: true,
  sort: 0,
  freeFromKopecks: null,
  regions: null,
  etaText: null,
  minOrderKopecks: 0,
};

describe('quoteDelivery: расчёт на сервере', () => {
  it('фиксированная стоимость; «рассчитает менеджер» — pending', () => {
    expect(quoteDelivery(base, 100_000, null)).toEqual({ ok: true, priceKopecks: 50_000, pending: false, free: false });
    expect(quoteDelivery({ ...base, priceKopecks: null }, 100_000, null)).toEqual({ ok: true, priceKopecks: null, pending: true, free: false });
  });

  it('порог бесплатной доставки включает границу и действует и при «рассчитает менеджер»', () => {
    const m = { ...base, freeFromKopecks: 300_000 };
    expect(quoteDelivery(m, 299_999, null)).toMatchObject({ priceKopecks: 50_000, free: false });
    expect(quoteDelivery(m, 300_000, null)).toEqual({ ok: true, priceKopecks: 0, pending: false, free: true });
    expect(quoteDelivery({ ...m, priceKopecks: null }, 300_000, null)).toMatchObject({ priceKopecks: 0, free: true });
  });

  it('минимальная сумма: ниже — способ недоступен, ровно на границе — доступен', () => {
    const m = { ...base, minOrderKopecks: 100_000 };
    expect(quoteDelivery(m, 99_999, null)).toMatchObject({ ok: false, reason: 'min_order' });
    expect(quoteDelivery(m, 100_000, null)).toMatchObject({ ok: true });
  });

  it('отключённый способ недоступен', () => {
    expect(quoteDelivery({ ...base, enabled: false }, 1, null)).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('география: адрес должен содержать регион или город; без адреса не проверяется', () => {
    const m = { ...base, regions: ['Москва', 'Московская область'] };
    expect(quoteDelivery(m, 1, null)).toMatchObject({ ok: true });
    expect(quoteDelivery(m, 1, 'г. Москва, ул. Тверская, 1')).toMatchObject({ ok: true });
    expect(quoteDelivery(m, 1, 'Московская обл., Химки')).toMatchObject({ ok: false, reason: 'geography' });
    expect(quoteDelivery(m, 1, 'Санкт-Петербург, Невский пр., 1')).toMatchObject({ ok: false, reason: 'geography' });
  });

  it('normalizePlace и addressInRegions: регистр, ё, границы слов', () => {
    expect(normalizePlace('  Г. Орёл,  ул. Ленина ')).toBe('г орел ул ленина');
    expect(addressInRegions('Орёл, Ленина 5', ['орел'])).toBe(true);
    expect(addressInRegions('Москва', ['Моск'])).toBe(false); // часть слова не считается
    expect(addressInRegions('где угодно', null)).toBe(true);
    expect(addressInRegions('где угодно', [])).toBe(true);
    expect(addressInRegions('Москва', ['а'])).toBe(false); // одиночная буква не считается названием
  });
});

const CONTACT = { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33', address: 'Москва, Тверская 1' };
function place(db: Db, deliveryCode: string, over: Record<string, unknown> = {}) {
  const c = cart.get(GUEST_A, { db });
  return checkout.place(
    { owner: GUEST_A, cartId: c.cartId, contact: { ...CONTACT }, deliveryMethodId: over.deliveryMethodId ?? deliveryId(db, deliveryCode), paymentMethodId: paymentId(db, 'cod'), idempotencyKey: `k-${Math.random().toString(36).slice(2)}-abcdefgh`, consent: true, ...over },
    { db, now: T0, secret: 'x'.repeat(40) },
  );
}
function setup(price = 200_000, qty = 1) {
  const db = setupDb();
  const p = addProduct(db, { price });
  cart.add(GUEST_A, { productId: p, qty }, { db, now: T0 });
  return db;
}

describe('оформление заказа использует настройки доставки', () => {
  it('стоимость и бесплатная доставка по порогу считаются сервером и попадают в заказ', async () => {
    const db = setup(200_000, 1);
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 40_000, freeFromKopecks: 200_000 }), { db, now: T0 });
    const order = await place(db, '', { deliveryMethodId: id });
    expect(order.deliveryKopecks).toBe(0);
    expect(order.totalKopecks).toBe(200_000);
    expect(order.delivery.pending).toBe(false);
  });

  it('ниже порога платная: итог = товары + доставка', async () => {
    const db = setup(100_000, 1);
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 40_000, freeFromKopecks: 200_000 }), { db, now: T0 });
    const order = await place(db, '', { deliveryMethodId: id });
    expect(order.deliveryKopecks).toBe(40_000);
    expect(order.totalKopecks).toBe(140_000);
  });

  it('порог считается от суммы товаров после скидки', async () => {
    const db = setup(250_000, 1);
    db.prepare("INSERT INTO promos (code, type, value, enabled, created_at, updated_at) VALUES ('P', 'fixed', 100000, 1, 1, 1)").run();
    cart.applyPromo(GUEST_A, 'P', { db, now: T0 });
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 40_000, freeFromKopecks: 200_000 }), { db, now: T0 });
    const order = await place(db, '', { deliveryMethodId: id });
    expect(order.deliveryKopecks).toBe(40_000); // 2 500 − 1 000 = 1 500 < 2 000
  });

  it('сумма ниже минимальной — отказ с понятной причиной у поля способа', async () => {
    const db = setup(50_000, 1);
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 0, minOrderKopecks: 100_000 }), { db, now: T0 });
    await expect(place(db, '', { deliveryMethodId: id })).rejects.toMatchObject({ fields: { deliveryMethodId: [expect.stringContaining('минимальная сумма')] } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
  });

  it('адрес вне географии — отказ, внутри — заказ создан', async () => {
    const db = setup(100_000, 1);
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 10_000, regions: ['Москва'] }), { db, now: T0 });
    await expect(place(db, '', { deliveryMethodId: id, contact: { ...CONTACT, address: 'Казань, Баумана 1' } })).rejects.toThrow(ValidationError);
    const ok = await place(db, '', { deliveryMethodId: id, contact: { ...CONTACT, address: 'Москва, Арбат 1' } });
    expect(ok.deliveryKopecks).toBe(10_000);
  });

  it('«рассчитает менеджер»: доставка не входит в итог, заказ помечен pending', async () => {
    const db = setup(100_000, 1);
    const order = await place(db, 'manual');
    expect(order.delivery.pending).toBe(true);
    expect(order.totalKopecks).toBe(100_000);
  });

  it('отключённый способ не принимается', async () => {
    const db = setup();
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер', priceKopecks: 0, enabled: false }), { db, now: T0 });
    await expect(place(db, '', { deliveryMethodId: id })).rejects.toThrow(ValidationError);
  });
});

function input(over: Record<string, unknown> = {}) {
  return {
    name: 'Способ',
    description: '',
    kind: 'manual',
    priceKopecks: 0,
    requiresAddress: true,
    enabled: true,
    sort: 30,
    freeFromKopecks: null,
    regions: null,
    etaText: '',
    minOrderKopecks: 0,
    ...over,
  };
}

describe('deliveryAdmin: CRUD, проверки, права, аудит', () => {
  it('создание сохраняет все поля; срок — только текст админа', () => {
    const db = setupDb();
    const id = deliveryAdmin.create(admin, input({ name: ' Курьер ', etaText: '1–3 дня', regions: ['Москва', 'Москва', 'Тула'], freeFromKopecks: 500_000 , priceKopecks: 30_000 }), { db, now: T0 });
    expect(methodsRepo.findDelivery(db, id)).toMatchObject({ name: 'Курьер', etaText: '1–3 дня', regions: ['Москва', 'Тула'], freeFromKopecks: 500_000, priceKopecks: 30_000, enabled: true });
  });

  it('пустой список регионов = вся страна', () => {
    const db = setupDb();
    const id = deliveryAdmin.create(admin, input({ regions: [] }), { db, now: T0 });
    expect(methodsRepo.findDelivery(db, id)!.regions).toBeNull();
  });

  it('проверки: отрицательные суммы, нулевой порог, порог при бесплатной доставке, самовывоз с географией', () => {
    const db = setupDb();
    const bad = (over: Record<string, unknown>) => expect(() => deliveryAdmin.create(admin, input(over), { db, now: T0 })).toThrow(ValidationError);
    bad({ priceKopecks: -1 });
    bad({ minOrderKopecks: -5 });
    bad({ freeFromKopecks: 0 });
    bad({ priceKopecks: 0, freeFromKopecks: 100 });
    bad({ kind: 'pickup', regions: ['Москва'] });
    bad({ name: 'А' });
    bad({ priceKopecks: 1.5 });
    bad({ kind: 'drone' });
  });

  it('обновление и аудит: есть before/after без лишних данных', () => {
    const db = setupDb();
    const id = deliveryAdmin.create(admin, input(), { db, now: T0 });
    deliveryAdmin.update(admin, id, input({ name: 'Новое', priceKopecks: 12_300 }), { db, now: T0 + 1 });
    const rows = audit.list({}, { db }).filter((r) => r.action.startsWith('delivery.'));
    expect(rows.map((r) => r.action).sort()).toEqual(['delivery.create', 'delivery.update']);
    expect(methodsRepo.findDelivery(db, id)).toMatchObject({ name: 'Новое', priceKopecks: 12_300 });
  });

  it('нельзя отключить или удалить последний включённый способ', () => {
    const db = setupDb();
    const [a, b] = methodsRepo.listDelivery(db);
    deliveryAdmin.setEnabled(admin, a!.id, false, { db, now: T0 });
    expect(() => deliveryAdmin.setEnabled(admin, b!.id, false, { db, now: T0 })).toThrow(ConflictError);
    expect(() => deliveryAdmin.remove(admin, b!.id, { db, now: T0 })).toThrow(ConflictError);
  });

  it('способ с заказами не удаляется, без заказов — удаляется', async () => {
    const db = setup(100_000, 1);
    const id = deliveryAdmin.create(admin, input({ name: 'Курьер' }), { db, now: T0 });
    await place(db, '', { deliveryMethodId: id });
    expect(() => deliveryAdmin.remove(admin, id, { db, now: T0 })).toThrow(ConflictError);
    const other = deliveryAdmin.create(admin, input({ name: 'Другой' }), { db, now: T0 });
    deliveryAdmin.remove(admin, other, { db, now: T0 });
    expect(methodsRepo.findDelivery(db, other)).toBeNull();
  });

  it('права: менеджер и аноним не могут ни читать, ни менять (403/401)', () => {
    const db = setupDb();
    const o = { db, now: T0 };
    expect(() => deliveryAdmin.list(manager, o)).toThrow(ForbiddenError);
    expect(() => deliveryAdmin.create(manager, input(), o)).toThrow(ForbiddenError);
    expect(() => deliveryAdmin.update(manager, 1, input(), o)).toThrow(ForbiddenError);
    expect(() => deliveryAdmin.setEnabled(manager, 1, false, o)).toThrow(ForbiddenError);
    expect(() => deliveryAdmin.remove(manager, 1, o)).toThrow(ForbiddenError);
    expect(() => deliveryAdmin.list(null, o)).toThrow(UnauthorizedError);
  });
});
