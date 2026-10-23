import { describe, expect, it } from 'vitest';
import { accountConsents, accountGate, accountOrders } from '@/domain/customers/account';
import { consent } from '@/domain/customers/consent';
import { hashToken, USER_SESSION_COOKIE } from '@/domain/customers/session';
import { cart } from '@/domain/ordering/cart';
import { sessionsRepo } from '@/server/db/repositories/sessions';
import { usersRepo } from '@/server/db/repositories/users';
import { NotFoundError } from '@/server/http/errors';
import { fakeCookies } from '../auth/helpers';
import { GUEST_A, T0, addProduct, rawOrder, setupDb } from '../ordering/helpers';

function newUser(db: ReturnType<typeof setupDb>, email: string): number {
  return usersRepo.insert(db, { email, passwordHash: 'x', now: T0 });
}

describe('вход в кабинет', () => {
  it('без сессии — редирект на вход с возвратом; с сессией — доступ', () => {
    const db = setupDb();
    const gate = accountGate(fakeCookies(), '/account/orders', { db, now: T0 });
    expect(gate).toEqual({ ok: false, redirectTo: '/account/login?next=%2Faccount%2Forders' });

    const id = newUser(db, 'me@example.test');
    sessionsRepo.insert(db, 'user', { ownerId: id, tokenHash: hashToken('tok'), now: T0, expiresAt: T0 + 100_000 });
    const ok = accountGate(fakeCookies({ [USER_SESSION_COOKIE]: 'tok' }), '/account', { db, now: T0 });
    expect(ok).toMatchObject({ ok: true, session: { userId: id, email: 'me@example.test' } });
  });
});

describe('мои заказы', () => {
  it('в списке только свои заказы; чужой — 404 и по номеру, и по числовому id', () => {
    const db = setupDb();
    const me = newUser(db, 'me@example.test');
    const other = newUser(db, 'other@example.test');
    const mine = rawOrder(db, 'new', { owner: { kind: 'user', userId: me } });
    const theirs = rawOrder(db, 'new', { owner: { kind: 'user', userId: other } });
    const guests = rawOrder(db, 'new', { owner: GUEST_A });

    expect(accountOrders.list(me, { db }).map((o) => o.number)).toEqual([mine.number]);
    expect(accountOrders.get(me, mine.number, { db }).number).toBe(mine.number);
    expect(() => accountOrders.get(me, theirs.number, { db })).toThrow(NotFoundError);
    expect(() => accountOrders.get(me, guests.number, { db })).toThrow(NotFoundError);
    expect(() => accountOrders.get(me, String(theirs.id), { db })).toThrow(NotFoundError);
    expect(() => accountOrders.get(me, 'RTS-999999', { db })).toThrow(NotFoundError);
    expect(() => accountOrders.reorder(me, theirs.number, { db })).toThrow(NotFoundError);
  });

  it('повторить заказ: доступное кладётся по текущей цене, недоступное пропускается с причиной', () => {
    const db = setupDb();
    const me = newUser(db, 'me@example.test');
    const owner = { kind: 'user' as const, userId: me };
    const ok = addProduct(db, { price: 100_000 });
    const gone = addProduct(db, { price: 50_000 });
    const order = rawOrder(db, 'delivered', { owner });
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, discount_price_kopecks, unit_kopecks, qty, line_kopecks) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    );
    insertItem.run(order.id, ok, 'Доступный', 'A', 100_000, 100_000, 2, 200_000);
    insertItem.run(order.id, gone, 'Снятый', 'B', 50_000, 50_000, 1, 50_000);
    // цена выросла, второй товар закончился
    db.prepare('UPDATE products SET price_kopecks = 120000 WHERE id = ?').run(ok);
    db.prepare('UPDATE products SET in_stock = 0 WHERE id = ?').run(gone);

    const res = accountOrders.reorder(me, order.number, { db, now: T0 });
    expect(res.added).toBe(1);
    expect(res.skipped).toEqual([{ name: 'Снятый', reason: 'Сейчас нет в наличии' }]);
    const view = cart.get(owner, { db, now: T0 });
    expect(view.items.map((i) => [i.productId, i.qty, i.unitKopecks])).toEqual([[ok, 2, 120_000]]);
  });
});

describe('согласия', () => {
  it('показывает только записи этого пользователя, новые первыми', () => {
    const db = setupDb();
    const me = newUser(db, 'me@example.test');
    const other = newUser(db, 'other@example.test');
    consent.record({ kind: 'privacy', source: 'register', userId: me }, { db, now: T0 });
    consent.record({ kind: 'privacy', source: 'checkout', userId: me }, { db, now: T0 + 5 });
    consent.record({ kind: 'privacy', source: 'register', userId: other }, { db, now: T0 });
    consent.record({ kind: 'privacy', source: 'callback', guestId: 'g', subject: 'x' }, { db, now: T0 });

    const list = accountConsents.list(me, { db });
    expect(list.map((c) => c.source)).toEqual(['checkout', 'register']);
  });
});
