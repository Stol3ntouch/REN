import { afterEach, describe, expect, it } from 'vitest';
import '@/domain/hooks';
import { cart } from '@/domain/ordering/cart';
import { login, register } from '@/domain/customers/auth';
import type { Db } from '@/server/db/connection';
import { GUEST_COOKIE } from '@/server/http/owner';
import { fakeCookies } from '../auth/helpers';
import { GUEST_A, GUEST_B, T0, addProduct, setupDb } from './helpers';

const globalRef = globalThis as unknown as { __rtsDb?: Db };
afterEach(() => {
  globalRef.__rtsDb = undefined;
});

const PASSWORD = 'correct-horse-battery';

describe('слияние корзин при входе и регистрации (через registerOnLoginHook)', () => {
  it('регистрация: гостевая корзина переходит новому пользователю', async () => {
    const db = setupDb();
    globalRef.__rtsDb = db;
    const p = addProduct(db, { price: 10_000 });
    cart.add(GUEST_A, { productId: p, qty: 3 }, { db, now: T0 });

    const cookies = fakeCookies({ [GUEST_COOKIE]: GUEST_A.guestId });
    const { userId } = await register({ email: 'new@example.test', password: PASSWORD, consent: true }, { db, cookies, ip: '1.1.1.1', now: T0 });

    expect(cart.get({ kind: 'user', userId }, { db, now: T0 }).items.map((i) => [i.productId, i.qty])).toEqual([[p, 3]]);
    expect(cart.get(GUEST_A, { db, now: T0 }).items).toHaveLength(0);
  });

  it('вход: корзина гостя сливается с уже существующей корзиной пользователя', async () => {
    const db = setupDb();
    globalRef.__rtsDb = db;
    const a = addProduct(db, { price: 10_000 });
    const b = addProduct(db, { price: 20_000 });
    const first = await register({ email: 'old@example.test', password: PASSWORD, consent: true }, { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 });
    const user = { kind: 'user' as const, userId: first.userId };
    cart.add(user, { productId: a, qty: 1 }, { db, now: T0 });
    cart.add(GUEST_B, { productId: a, qty: 2 }, { db, now: T0 });
    cart.add(GUEST_B, { productId: b, qty: 1 }, { db, now: T0 });

    await login({ email: 'old@example.test', password: PASSWORD }, { db, cookies: fakeCookies({ [GUEST_COOKIE]: GUEST_B.guestId }), ip: '1.1.1.1', now: T0 });

    const qty = Object.fromEntries(cart.get(user, { db, now: T0 }).items.map((i) => [i.productId, i.qty]));
    expect(qty).toEqual({ [a]: 3, [b]: 1 });
    expect(cart.get(GUEST_B, { db, now: T0 }).items).toHaveLength(0);
  });
});
