import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { cartsRepo } from '@/server/db/repositories/carts';
import type { OwnerRef } from '@/server/http/owner';
import { GUEST_A, GUEST_B, T0, addProduct, setupDb } from './helpers';

const USER: OwnerRef = { kind: 'user', userId: 1 };

function dbWithUser() {
  const db = setupDb();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'u@x.test', 'x', 1)").run();
  return db;
}

describe('cart: добавление, количество, удаление', () => {
  it('пустая корзина — нули, нет cartId', () => {
    const db = setupDb();
    expect(cart.get(GUEST_A, { db })).toMatchObject({ cartId: null, items: [], count: 0, subtotalKopecks: 0, totalKopecks: 0, promo: null });
  });

  it('add кладёт товар; суммы считает сервер по цене из БД', () => {
    const db = setupDb();
    const p = addProduct(db, { price: 150_000 });
    const view = cart.add(GUEST_A, { productId: p, qty: 2 }, { db, now: T0 });
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ productId: p, qty: 2, unitKopecks: 150_000, lineKopecks: 300_000, available: true });
    expect(view).toMatchObject({ count: 2, subtotalKopecks: 300_000, totalKopecks: 300_000 });
  });

  it('скидочная цена берётся только при discount < price', () => {
    const db = setupDb();
    const good = addProduct(db, { price: 100_000, discount: 80_000 });
    const bad = addProduct(db, { price: 100_000, discount: 120_000 });
    cart.add(GUEST_A, { productId: good, qty: 1 }, { db });
    const view = cart.add(GUEST_A, { productId: bad, qty: 1 }, { db });
    expect(view.items.find((i) => i.productId === good)).toMatchObject({ unitKopecks: 80_000, originalKopecks: 100_000 });
    expect(view.items.find((i) => i.productId === bad)).toMatchObject({ unitKopecks: 100_000, originalKopecks: null });
  });

  it('повторное add суммирует количество, но не больше 20 на позицию (с пометкой notice)', () => {
    const db = setupDb();
    const p = addProduct(db);
    cart.add(GUEST_A, { productId: p, qty: 15 }, { db });
    const view = cart.add(GUEST_A, { productId: p, qty: 10 }, { db });
    expect(view.items[0]!.qty).toBe(20);
    expect(view.notice).toMatch(/20/);
  });

  it('количество вне 1–20 и нецелое отклоняется (400), корзина не меняется', () => {
    const db = setupDb();
    const p = addProduct(db);
    for (const qty of [0, -1, 21, 1.5, Number.NaN]) {
      expect(() => cart.add(GUEST_A, { productId: p, qty }, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    }
    expect(cart.get(GUEST_A, { db }).items).toHaveLength(0);
  });

  it('нет такого товара или он снят с публикации → 404; нет в наличии → 400 (серверный отказ R10.2)', () => {
    const db = setupDb();
    const hidden = addProduct(db, { published: false });
    const out = addProduct(db, { inStock: false });
    expect(() => cart.add(GUEST_A, { productId: 99999, qty: 1 }, { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => cart.add(GUEST_A, { productId: hidden, qty: 1 }, { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => cart.add(GUEST_A, { productId: out, qty: 1 }, { db })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('setQty меняет количество (1–20); remove убирает позицию', () => {
    const db = setupDb();
    const p = addProduct(db, { price: 10_000 });
    cart.add(GUEST_A, { productId: p, qty: 1 }, { db });
    expect(cart.setQty(GUEST_A, p, 7, { db }).totalKopecks).toBe(70_000);
    expect(() => cart.setQty(GUEST_A, p, 21, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(cart.remove(GUEST_A, p, { db }).items).toHaveLength(0);
  });

  it('корзины гостей независимы', () => {
    const db = setupDb();
    const p = addProduct(db);
    cart.add(GUEST_A, { productId: p, qty: 3 }, { db });
    expect(cart.get(GUEST_B, { db }).count).toBe(0);
  });

  it('снятый с публикации товар остаётся в корзине как недоступный и не входит в сумму', () => {
    const db = setupDb();
    const a = addProduct(db, { price: 10_000 });
    const b = addProduct(db, { price: 20_000 });
    cart.add(GUEST_A, { productId: a, qty: 1 }, { db });
    cart.add(GUEST_A, { productId: b, qty: 1 }, { db });
    db.prepare('UPDATE products SET in_stock = 0 WHERE id = ?').run(b);
    const view = cart.get(GUEST_A, { db });
    expect(view.items.find((i) => i.productId === b)!.available).toBe(false);
    expect(view.subtotalKopecks).toBe(10_000);
  });
});

describe('cart.merge: слияние гостевой корзины с корзиной пользователя', () => {
  it('нет корзины пользователя — гостевая переходит к нему целиком', () => {
    const db = dbWithUser();
    const p = addProduct(db);
    cart.add(GUEST_A, { productId: p, qty: 2 }, { db });
    cart.merge(GUEST_A.guestId, 1, { db });
    expect(cart.get(USER, { db }).items.map((i) => [i.productId, i.qty])).toEqual([[p, 2]]);
    expect(cart.get(GUEST_A, { db }).items).toHaveLength(0);
  });

  it('обе корзины: количества складываются (потолок 20), новые позиции добавляются, гостевая исчезает', () => {
    const db = dbWithUser();
    const a = addProduct(db);
    const b = addProduct(db);
    const c = addProduct(db);
    cart.add(USER, { productId: a, qty: 15 }, { db });
    cart.add(USER, { productId: b, qty: 1 }, { db });
    cart.add(GUEST_A, { productId: a, qty: 10 }, { db });
    cart.add(GUEST_A, { productId: c, qty: 4 }, { db });
    cart.merge(GUEST_A.guestId, 1, { db });
    const view = cart.get(USER, { db });
    const qty = Object.fromEntries(view.items.map((i) => [i.productId, i.qty]));
    expect(qty).toEqual({ [a]: 20, [b]: 1, [c]: 4 });
    expect(cartsRepo.findByOwner(db, GUEST_A)).toBeNull();
  });

  it('промокод гостя переходит, если у пользователя своего нет; пользовательский сохраняется', () => {
    const db = dbWithUser();
    const p = addProduct(db);
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at) VALUES ('G10', 'percent', 10, 1, 1), ('U5', 'percent', 5, 1, 1)").run();
    cart.add(GUEST_A, { productId: p, qty: 1 }, { db });
    cart.applyPromo(GUEST_A, 'g10', { db, now: T0 });
    cart.merge(GUEST_A.guestId, 1, { db, now: T0 });
    expect(cart.get(USER, { db, now: T0 }).promo?.code).toBe('G10');

    cart.add(GUEST_B, { productId: p, qty: 1 }, { db });
    cart.applyPromo(GUEST_B, 'g10', { db, now: T0 });
    cart.applyPromo(USER, 'u5', { db, now: T0 });
    cart.merge(GUEST_B.guestId, 1, { db, now: T0 });
    expect(cart.get(USER, { db, now: T0 }).promo?.code).toBe('U5');
  });

  it('пустого гостя нет — ничего не происходит', () => {
    const db = dbWithUser();
    expect(() => cart.merge(GUEST_A.guestId, 1, { db })).not.toThrow();
    expect(() => cart.merge(null, 1, { db })).not.toThrow();
  });
});

describe('cart.applyPromo', () => {
  const NOW = T0;
  function setup() {
    const db = setupDb();
    const p = addProduct(db, { price: 100_000 });
    cart.add(GUEST_A, { productId: p, qty: 2 }, { db });
    return { db, p };
  }

  it('действующий промокод даёт скидку в копейках; код не зависит от регистра', () => {
    const { db } = setup();
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at) VALUES ('AUTUMN', 'percent', 10, 1, 1)").run();
    const res = cart.applyPromo(GUEST_A, ' autumn ', { db, now: NOW });
    expect(res.error).toBeUndefined();
    expect(res.cart).toMatchObject({ discountKopecks: 20_000, totalKopecks: 180_000, promo: { code: 'AUTUMN', discountKopecks: 20_000 } });
  });

  it('просроченный: понятная ошибка, корзина цела, прежний промокод остаётся', () => {
    const { db } = setup();
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at) VALUES ('GOOD', 'fixed', 5000, 1, 1)").run();
    db.prepare("INSERT INTO promos (code, type, value, ends_at, created_at, updated_at) VALUES ('OLD', 'percent', 50, ?, 1, 1)").run(NOW - 1);
    cart.applyPromo(GUEST_A, 'GOOD', { db, now: NOW });
    const res = cart.applyPromo(GUEST_A, 'OLD', { db, now: NOW });
    expect(res.error).toMatch(/истёк/);
    expect(res.cart.items).toHaveLength(1);
    expect(res.cart.promo?.code).toBe('GOOD');
  });

  it('несуществующий и выключенный промокоды — ошибка; лимит и минимальная сумма — ошибка', () => {
    const { db } = setup();
    db.prepare("INSERT INTO promos (code, type, value, enabled, created_at, updated_at) VALUES ('OFF', 'percent', 5, 0, 1, 1)").run();
    db.prepare("INSERT INTO promos (code, type, value, usage_limit, used_count, created_at, updated_at) VALUES ('FULL', 'percent', 5, 1, 1, 1, 1)").run();
    db.prepare("INSERT INTO promos (code, type, value, min_subtotal_kopecks, created_at, updated_at) VALUES ('BIG', 'percent', 5, 999999, 1, 1)").run();
    for (const code of ['NOPE', 'OFF', 'FULL', 'BIG']) {
      const res = cart.applyPromo(GUEST_A, code, { db, now: NOW });
      expect(res.error, code).toBeTruthy();
      expect(res.cart.promo).toBeNull();
    }
  });

  it('removePromo снимает промокод; один промокод на корзину (новый заменяет старый)', () => {
    const { db } = setup();
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at) VALUES ('A', 'percent', 10, 1, 1), ('B', 'percent', 20, 1, 1)").run();
    cart.applyPromo(GUEST_A, 'A', { db, now: NOW });
    expect(cart.applyPromo(GUEST_A, 'B', { db, now: NOW }).cart.promo?.code).toBe('B');
    expect(cart.removePromo(GUEST_A, { db, now: NOW }).promo).toBeNull();
  });
});
