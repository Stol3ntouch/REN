import { describe, expect, it } from 'vitest';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { orderAccessToken, verifyOrderAccessToken } from '@/domain/ordering/access-token';
import { orders } from '@/domain/ordering/orders';
import type { Order } from '@/domain/ordering/types';
import type { Db } from '@/server/db/connection';
import type { OwnerRef } from '@/server/http/owner';
import { GUEST_A, GUEST_B, SECRET, T0, addProduct, deliveryId, paymentId, setupDb } from './helpers';

const USER_1: OwnerRef = { kind: 'user', userId: 1 };
const USER_2: OwnerRef = { kind: 'user', userId: 2 };

async function place(db: Db, owner: OwnerRef): Promise<Order> {
  const p = addProduct(db, { price: 10_000 });
  cart.add(owner, { productId: p, qty: 1 }, { db, now: T0 });
  return checkout.place(
    {
      owner,
      cartId: cart.get(owner, { db }).cartId,
      contact: { name: 'Пётр Петров', email: 'p@example.test', phone: '+7 900 000-00-00' },
      deliveryMethodId: deliveryId(db, 'pickup'),
      paymentMethodId: paymentId(db, 'cod'),
      idempotencyKey: `k-${Math.random().toString(36).slice(2)}-0123456789`,
      consent: true,
    },
    { db, now: T0, secret: SECRET },
  );
}

function twoUsers(db: Db) {
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'a@x.test', 'x', 1), (2, 'b@x.test', 'x', 1)").run();
}

describe('доступ к заказу: только владелец, чужой — «не найден»', () => {
  it('владелец видит заказ по номеру и по id', async () => {
    const db = setupDb();
    twoUsers(db);
    const o = await place(db, USER_1);
    expect(orders.getForCustomer(o.number, USER_1, { db })?.id).toBe(o.id);
    expect(orders.getForCustomer(o.id, USER_1, { db })?.id).toBe(o.id);
  });

  it('другой пользователь не получает заказ ни по номеру, ни по id, ни в нижнем регистре', async () => {
    const db = setupDb();
    twoUsers(db);
    const o = await place(db, USER_1);
    expect(orders.getForCustomer(o.number, USER_2, { db })).toBeNull();
    expect(orders.getForCustomer(o.id, USER_2, { db })).toBeNull();
    expect(orders.getForCustomer(o.number.toLowerCase(), USER_2, { db })).toBeNull();
    expect(orders.getForCustomer(o.number, null, { db })).toBeNull();
    expect(orders.listForOwner(USER_2, { db })).toEqual([]);
  });

  it('гость видит свой заказ по cookie, чужой гость и пользователь — нет', async () => {
    const db = setupDb();
    twoUsers(db);
    const o = await place(db, GUEST_A);
    expect(orders.getForCustomer(o.number, GUEST_A, { db })?.id).toBe(o.id);
    expect(orders.getForCustomer(o.number, GUEST_B, { db })).toBeNull();
    expect(orders.getForCustomer(o.number, USER_1, { db })).toBeNull();
  });

  it('несуществующий номер ведёт себя так же, как чужой: null', () => {
    const db = setupDb();
    expect(orders.getForCustomer('RTS-999999', GUEST_A, { db })).toBeNull();
    expect(orders.getForCustomer(424242, GUEST_A, { db })).toBeNull();
  });
});

describe('гостевая ссылка с подписанным токеном', () => {
  it('верный токен открывает заказ без cookie', async () => {
    const db = setupDb();
    const o = await place(db, GUEST_A);
    const token = orderAccessToken(o.number, SECRET);
    expect(orders.getByGuestToken(o.number, token, { db, secret: SECRET })?.id).toBe(o.id);
  });

  it('токен другого заказа, пустой, обрезанный и с другим секретом → null (одинаково для существующих и нет)', async () => {
    const db = setupDb();
    const a = await place(db, GUEST_A);
    const b = await place(db, GUEST_B);
    const tokenB = orderAccessToken(b.number, SECRET);
    const tokenA = orderAccessToken(a.number, SECRET);
    const run = (n: string, t: string | null | undefined) => orders.getByGuestToken(n, t, { db, secret: SECRET });
    expect(run(a.number, tokenB)).toBeNull();
    expect(run(a.number, '')).toBeNull();
    expect(run(a.number, null)).toBeNull();
    expect(run(a.number, tokenA.slice(0, -1))).toBeNull();
    expect(run(a.number, `${tokenA}x`)).toBeNull();
    expect(orders.getByGuestToken(a.number, tokenA, { db, secret: 'y'.repeat(40) })).toBeNull();
    // перебор номеров без токена ничего не раскрывает
    for (let n = 1; n <= 5; n++) expect(run(`RTS-${String(n).padStart(6, '0')}`, 'guess')).toBeNull();
    expect(run('RTS-000999', tokenA)).toBeNull();
  });

  it('токен — HMAC от номера: стабилен, различен у разных заказов, проверка не принимает мусор', () => {
    const t1 = orderAccessToken('RTS-000001', SECRET);
    expect(orderAccessToken('RTS-000001', SECRET)).toBe(t1);
    expect(orderAccessToken('RTS-000002', SECRET)).not.toBe(t1);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyOrderAccessToken('RTS-000001', t1, SECRET)).toBe(true);
    expect(verifyOrderAccessToken('RTS-000002', t1, SECRET)).toBe(false);
    expect(verifyOrderAccessToken('RTS-000001', 'a'.repeat(500), SECRET)).toBe(false);
  });

  it('история для покупателя не содержит служебных заметок сотрудников', async () => {
    const db = setupDb();
    const o = await place(db, GUEST_A);
    // комментарий хранится с автором (staff_id → staff), поэтому сотрудник должен существовать
    db.prepare("INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'm@x.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), 'x', 1)").run();
    orders.addNote(o.id, 'клиент грубил', { type: 'staff', staffId: 1, role: 'manager' }, { db, now: T0 });
    await orders.transition(o.id, 'processing', { type: 'staff', staffId: 1, role: 'manager' }, 'взяли в работу', { db, now: T0 });
    const forCustomer = orders.events(o.id, { db, forCustomer: true });
    expect(forCustomer.map((e) => e.kind)).toEqual(['created', 'status']);
    expect(forCustomer.every((e) => e.note === null)).toBe(true);
    expect(orders.events(o.id, { db }).map((e) => e.kind)).toEqual(['created', 'note', 'status']);
  });
});
