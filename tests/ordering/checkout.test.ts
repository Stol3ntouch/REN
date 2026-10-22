import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { CheckoutChangesError, checkout } from '@/domain/ordering/checkout';
import { ordersRepo } from '@/server/db/repositories/orders';
import type { Db } from '@/server/db/connection';
import type { OwnerRef } from '@/server/http/owner';
import { GUEST_A, GUEST_B, T0, addProduct, deliveryId, paymentId, setupDb } from './helpers';

const CONTACT = { name: 'Иван Иванов', email: 'Ivan@Example.test', phone: '+7 (900) 111-22-33' };

type Over = Record<string, unknown>;
function input(db: Db, owner: OwnerRef, over: Over = {}) {
  const c = cart.get(owner, { db });
  return {
    owner,
    cartId: c.cartId,
    contact: { ...CONTACT },
    deliveryMethodId: deliveryId(db, 'pickup'),
    paymentMethodId: paymentId(db, 'cod'),
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}-abcdefgh`,
    consent: true,
    ...over,
  };
}
const opts = (db: Db, extra: Over = {}) => ({ db, now: T0, secret: 'x'.repeat(40), ...extra });
const mails = (db: Db) =>
  (db.prepare('SELECT event, payload_json FROM mail_stub_queue ORDER BY id').all() as { event: string; payload_json: string }[]).map((r) => ({
    event: r.event,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
  }));

function filled(db: Db, owner: OwnerRef = GUEST_A) {
  const a = addProduct(db, { name: 'Бензопила', sku: 'CS-1', price: 500_000, discount: 450_000 });
  const b = addProduct(db, { name: 'Масло', sku: 'OIL-2', price: 30_000 });
  cart.add(owner, { productId: a, qty: 2 }, { db, now: T0 });
  cart.add(owner, { productId: b, qty: 1 }, { db, now: T0 });
  return { a, b };
}

describe('checkout.place: серверный пересчёт', () => {
  it('заказ создаётся по серверным ценам; подмена цены, суммы и позиций в запросе игнорируется', async () => {
    const db = setupDb();
    const { a } = filled(db);
    const spoofed = input(db, GUEST_A, {
      totalKopecks: 1,
      subtotalKopecks: 1,
      items: [{ productId: a, qty: 20, unitKopecks: 1, priceKopecks: 1 }],
      discountKopecks: 999_999,
    });
    const order = await checkout.place(spoofed, opts(db));
    expect(order.number).toBe('RTS-000001');
    expect(order.status).toBe('new');
    // 2 × 4 500,00 (скидочная) + 300,00
    expect(order.subtotalKopecks).toBe(930_000);
    expect(order.discountKopecks).toBe(0);
    expect(order.totalKopecks).toBe(930_000);
    expect(order.items.map((i) => [i.productId, i.qty, i.unitKopecks])).toEqual([
      [a, 2, 450_000],
      [expect.any(Number), 1, 30_000],
    ]);
    expect(order.contact.email).toBe('ivan@example.test');
  });

  it('строка заказа хранит снимок названия, артикула, цены и скидки; смена товара прошлый заказ не меняет', async () => {
    const db = setupDb();
    const { a } = filled(db);
    const order = await checkout.place(input(db, GUEST_A), opts(db));
    db.prepare("UPDATE products SET name = 'Другое имя', sku = 'NEW', price_kopecks = 1, discount_price_kopecks = NULL WHERE id = ?").run(a);
    const row = ordersRepo.listItems(db, order.id).find((i) => i.productId === a)!;
    expect(row).toMatchObject({ name: 'Бензопила', sku: 'CS-1', priceKopecks: 500_000, discountPriceKopecks: 450_000, unitKopecks: 450_000, qty: 2, lineKopecks: 900_000 });
    const reloaded = ordersRepo.findById(db, order.id)!;
    expect(reloaded.totalKopecks).toBe(930_000);
  });

  it('после оформления корзина пуста; согласие записано; письмо order.created поставлено один раз', async () => {
    const db = setupDb();
    filled(db);
    const order = await checkout.place(input(db, GUEST_A), opts(db));
    expect(cart.get(GUEST_A, { db }).items).toHaveLength(0);
    const consent = db.prepare("SELECT kind, source, guest_id FROM consents WHERE source = 'checkout'").all();
    expect(consent).toHaveLength(1);
    const m = mails(db).filter((x) => x.event === 'order.created');
    expect(m).toHaveLength(1);
    expect(m[0]!.payload).toMatchObject({ to: 'ivan@example.test', orderNumber: order.number, totalKopecks: 930_000 });
    expect(String(m[0]!.payload.orderUrl)).toContain(`/order/${order.number}?t=`);
  });
});

describe('checkout.validate: изменения после добавления в корзину', () => {
  it('без изменений → ok с серверным итогом', async () => {
    const db = setupDb();
    filled(db);
    const c = cart.get(GUEST_A, { db });
    const res = await checkout.validate(c.cartId, GUEST_A, opts(db));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.priced.subtotal).toBe(930_000);
  });

  it('цена изменилась → список изменений, заказ не создан; после подтверждения заказ по новой цене', async () => {
    const db = setupDb();
    const { b } = filled(db);
    const req = input(db, GUEST_A);
    db.prepare('UPDATE products SET price_kopecks = 40_000 WHERE id = ?').run(b);
    const res = await checkout.validate(req.cartId, GUEST_A, opts(db));
    expect(res).toMatchObject({ ok: false, changes: [{ kind: 'price_changed', productId: b, oldUnitKopecks: 30_000, newUnitKopecks: 40_000 }] });
    await expect(checkout.place(req, opts(db))).rejects.toBeInstanceOf(CheckoutChangesError);
    expect(ordersRepo.count(db)).toBe(0);

    cart.acknowledgeChanges(GUEST_A, opts(db));
    const order = await checkout.place(req, opts(db));
    expect(order.totalKopecks).toBe(900_000 + 40_000);
  });

  it('товар закончился или снят → «недоступен», заказ не создан; подтверждение убирает позицию', async () => {
    const db = setupDb();
    const { a, b } = filled(db);
    const req = input(db, GUEST_A);
    db.prepare('UPDATE products SET in_stock = 0 WHERE id = ?').run(b);
    db.prepare('UPDATE products SET published = 0 WHERE id = ?').run(a);
    const res = await checkout.validate(req.cartId, GUEST_A, opts(db));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.changes.map((c) => c.kind)).toEqual(['unavailable', 'unavailable']);
      expect(res.changes.map((c) => (c.kind === 'unavailable' ? c.reason : ''))).toEqual(['unpublished', 'out_of_stock']);
    }
    await expect(checkout.place(req, opts(db))).rejects.toBeInstanceOf(CheckoutChangesError);
    expect(ordersRepo.count(db)).toBe(0);
    expect(cart.acknowledgeChanges(GUEST_A, opts(db)).items).toHaveLength(0);
  });

  it('промокод истёк между корзиной и заказом → изменение promo_invalid, заказ не создан, корзина цела', async () => {
    const db = setupDb();
    filled(db);
    db.prepare("INSERT INTO promos (code, type, value, ends_at, created_at, updated_at) VALUES ('SOON', 'percent', 10, ?, 1, 1)").run(T0 + 1000);
    expect(cart.applyPromo(GUEST_A, 'SOON', opts(db)).error).toBeUndefined();
    const req = input(db, GUEST_A);
    const late = opts(db, { now: T0 + 5000 });
    const res = await checkout.validate(req.cartId, GUEST_A, late);
    expect(res).toMatchObject({ ok: false, changes: [{ kind: 'promo_invalid', code: 'SOON' }] });
    await expect(checkout.place(req, late)).rejects.toBeInstanceOf(CheckoutChangesError);
    expect(ordersRepo.count(db)).toBe(0);
    expect(cart.get(GUEST_A, { db }).items).toHaveLength(2);
  });

  it('чужая корзина → 404', async () => {
    const db = setupDb();
    filled(db, GUEST_A);
    const c = cart.get(GUEST_A, { db });
    await expect(checkout.validate(c.cartId, GUEST_B, opts(db))).rejects.toMatchObject({ status: 404 });
    await expect(checkout.place(input(db, GUEST_A, { owner: GUEST_B }), opts(db))).rejects.toMatchObject({ status: 404 });
  });
});

describe('checkout.place: идемпотентность', () => {
  it('два place с одним ключом → один заказ, одно письмо, один расход промокода', async () => {
    const db = setupDb();
    filled(db);
    db.prepare("INSERT INTO promos (code, type, value, usage_limit, created_at, updated_at) VALUES ('ONCE', 'fixed', 10000, 5, 1, 1)").run();
    cart.applyPromo(GUEST_A, 'ONCE', opts(db));
    const req = input(db, GUEST_A, { idempotencyKey: 'same-key-0123456789' });
    const [first, second] = await Promise.all([checkout.place(req, opts(db)), checkout.place(req, opts(db))]);
    expect(second.id).toBe(first.id);
    expect(ordersRepo.count(db)).toBe(1);
    expect(mails(db).filter((m) => m.event === 'order.created')).toHaveLength(1);
    expect((db.prepare("SELECT used_count FROM promos WHERE code = 'ONCE'").get() as { used_count: number }).used_count).toBe(1);
    expect(first.discountKopecks).toBe(10_000);
    expect(first.totalKopecks).toBe(930_000 - 10_000);
  });

  it('повтор после обновления страницы (корзина уже пуста) возвращает тот же заказ', async () => {
    const db = setupDb();
    filled(db);
    const req = input(db, GUEST_A, { idempotencyKey: 'refresh-key-0123456789' });
    const first = await checkout.place(req, opts(db));
    expect(cart.get(GUEST_A, { db }).items).toHaveLength(0);
    const again = await checkout.place(req, opts(db));
    expect(again.number).toBe(first.number);
    expect(ordersRepo.count(db)).toBe(1);
  });

  it('чужой ключ: другой владелец с тем же ключом получает отказ, а не чужой заказ', async () => {
    const db = setupDb();
    filled(db, GUEST_A);
    const req = input(db, GUEST_A, { idempotencyKey: 'victim-key-0123456789' });
    await checkout.place(req, opts(db));
    filled(db, GUEST_B);
    const attack = input(db, GUEST_B, { idempotencyKey: 'victim-key-0123456789' });
    await expect(checkout.place(attack, opts(db))).rejects.toMatchObject({ status: 409 });
  });

  it('на уровне БД: второй заказ с тем же idempotency_key вставить нельзя (UNIQUE)', async () => {
    const db = setupDb();
    filled(db);
    const order = await checkout.place(input(db, GUEST_A, { idempotencyKey: 'db-key-0123456789ab' }), opts(db));
    const row = ordersRepo.findById(db, order.id)!;
    expect(() => db.prepare('INSERT INTO orders (status, contact_name, contact_name_lc, contact_email, contact_phone, phone_digits, delivery_code, delivery_name, delivery_kind, payment_code, payment_name, payment_kind, subtotal_kopecks, total_kopecks, guest_id, idempotency_key, created_at, updated_at) VALUES (\'new\', \'a\', \'a\', \'a@a.a\', \'1\', \'1\', \'d\', \'d\', \'d\', \'p\', \'p\', \'p\', 0, 0, \'g\', ?, 1, 1)').run(row.idempotencyKey)).toThrow(/UNIQUE/);
  });

  it('разные ключи дают разные последовательные номера', async () => {
    const db = setupDb();
    filled(db, GUEST_A);
    filled(db, GUEST_B);
    const one = await checkout.place(input(db, GUEST_A), opts(db));
    const two = await checkout.place(input(db, GUEST_B), opts(db));
    expect([one.number, two.number]).toEqual(['RTS-000001', 'RTS-000002']);
  });
});

describe('checkout.place: способы доставки и оплаты, данные', () => {
  it('выключенный способ доставки или оплаты отклоняется сервером', async () => {
    const db = setupDb();
    filled(db);
    db.prepare("UPDATE delivery_methods SET enabled = 0 WHERE code = 'pickup'").run();
    await expect(checkout.place(input(db, GUEST_A), opts(db))).rejects.toMatchObject({ status: 400 });
    db.prepare("UPDATE delivery_methods SET enabled = 1 WHERE code = 'pickup'").run();
    db.prepare("UPDATE payment_methods SET enabled = 0 WHERE code = 'cod'").run();
    await expect(checkout.place(input(db, GUEST_A), opts(db))).rejects.toMatchObject({ status: 400 });
    expect(ordersRepo.count(db)).toBe(0);
  });

  it('тестовый метод «онлайн (ТЕСТ)» заведён выключенным; в production не принимается даже включённым', async () => {
    const db = setupDb();
    expect(checkout.methods(opts(db)).payment.map((m: { code: string }) => m.code)).toEqual(['cod']);
    const { methodsRepo } = await import('@/server/db/repositories/methods');
    methodsRepo.insertOnlineTestIfMissing(db);
    expect(db.prepare("SELECT enabled, test_only FROM payment_methods WHERE code = 'online_test'").get()).toMatchObject({ enabled: 0, test_only: 1 });
    expect(checkout.methods(opts(db)).payment.map((m: { code: string }) => m.code)).toEqual(['cod']);

    methodsRepo.setPaymentEnabled(db, 'online_test', true);
    expect(checkout.methods(opts(db, { production: false })).payment.map((m: { code: string }) => m.code)).toEqual(['cod', 'online_test']);
    expect(checkout.methods(opts(db, { production: true })).payment.map((m: { code: string }) => m.code)).toEqual(['cod']);

    filled(db);
    const online = input(db, GUEST_A, { paymentMethodId: paymentId(db, 'online_test') });
    await expect(checkout.place(online, opts(db, { production: true }))).rejects.toMatchObject({ status: 400 });
    const order = await checkout.place(online, opts(db, { production: false }));
    expect(order.status).toBe('awaiting_payment');
  });

  it('«доставка по согласованию»: адрес обязателен, стоимость — «рассчитает менеджер» (без цифр), итог без доставки', async () => {
    const db = setupDb();
    filled(db);
    const manual = deliveryId(db, 'manual');
    await expect(checkout.place(input(db, GUEST_A, { deliveryMethodId: manual }), opts(db))).rejects.toMatchObject({ status: 400 });
    const order = await checkout.place(
      input(db, GUEST_A, { deliveryMethodId: manual, contact: { ...CONTACT, address: 'г. Пример, ул. Садовая, 1' } }),
      opts(db),
    );
    expect(order.delivery).toMatchObject({ code: 'manual', priceKopecks: null, pending: true });
    expect(order.deliveryKopecks).toBe(0);
    expect(order.totalKopecks).toBe(930_000);
  });

  it('самовывоз стоит 0 ₽', async () => {
    const db = setupDb();
    filled(db);
    const order = await checkout.place(input(db, GUEST_A), opts(db));
    expect(order.delivery).toMatchObject({ code: 'pickup', priceKopecks: 0, pending: false });
  });

  it('пустая корзина, нет согласия, плохой email/телефон/имя/ключ → 400, заказ не создан', async () => {
    const db = setupDb();
    await expect(checkout.place(input(db, GUEST_A), opts(db))).rejects.toMatchObject({ status: 400 });
    filled(db);
    const bad: Over[] = [
      { consent: false },
      { consent: undefined },
      { contact: { ...CONTACT, email: 'not-an-email' } },
      { contact: { ...CONTACT, phone: '12' } },
      { contact: { ...CONTACT, name: ' ' } },
      { idempotencyKey: 'short' },
    ];
    for (const over of bad) {
      await expect(checkout.place(input(db, GUEST_A, over), opts(db))).rejects.toMatchObject({ status: 400 });
    }
    expect(ordersRepo.count(db)).toBe(0);
  });

  it('вошедший пользователь: заказ принадлежит ему', async () => {
    const db = setupDb();
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (7, 'u@x.test', 'x', 1)").run();
    const user: OwnerRef = { kind: 'user', userId: 7 };
    filled(db, user);
    const order = await checkout.place(input(db, user), opts(db));
    expect(order.owner).toEqual(user);
  });
});
