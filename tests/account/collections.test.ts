import { afterEach, describe, expect, it } from 'vitest';
import '@/domain/hooks';
import { compare, compareCount, MAX_COMPARE } from '@/domain/customers/compare';
import { favorites, favoritesCount } from '@/domain/customers/favorites';
import { login, register } from '@/domain/customers/auth';
import type { Db } from '@/server/db/connection';
import { ConflictError, NotFoundError } from '@/server/http/errors';
import { GUEST_COOKIE } from '@/server/http/owner';
import { fakeCookies } from '../auth/helpers';
import { GUEST_A, GUEST_B, T0, addProduct, setupDb } from '../ordering/helpers';

const globalRef = globalThis as unknown as { __rtsDb?: Db };
afterEach(() => {
  globalRef.__rtsDb = undefined;
});

const PASSWORD = 'correct-horse-battery';
const user = (userId: number) => ({ kind: 'user' as const, userId });

describe('избранное', () => {
  it('добавляет без дублей, снимает, считает; у разных владельцев списки разные', () => {
    const db = setupDb();
    const a = addProduct(db);
    const b = addProduct(db);
    favorites.add(GUEST_A, a, { db, now: T0 });
    favorites.add(GUEST_A, a, { db, now: T0 + 1 });
    favorites.add(GUEST_A, b, { db, now: T0 + 2 });
    favorites.add(GUEST_B, a, { db, now: T0 });

    expect(favorites.list(GUEST_A, { db })).toEqual([b, a]);
    expect(favoritesCount(GUEST_A, { db })).toBe(2);
    expect(favoritesCount(GUEST_B, { db })).toBe(1);

    favorites.remove(GUEST_A, a, { db });
    expect(favorites.list(GUEST_A, { db })).toEqual([b]);
    expect(favorites.has(GUEST_B, a, { db })).toBe(true);
    expect(favoritesCount(null, { db })).toBe(0);
  });

  it('toggle переключает и сообщает состояние; несуществующий и неопубликованный товар → 404', () => {
    const db = setupDb();
    const a = addProduct(db);
    const hidden = addProduct(db, { published: false });
    expect(favorites.toggle(GUEST_A, a, { db, now: T0 })).toMatchObject({ on: true, count: 1 });
    expect(favorites.toggle(GUEST_A, a, { db, now: T0 })).toMatchObject({ on: false, count: 0 });
    expect(() => favorites.add(GUEST_A, 999_999, { db, now: T0 })).toThrow(NotFoundError);
    expect(() => favorites.add(GUEST_A, hidden, { db, now: T0 })).toThrow(NotFoundError);
  });
});

describe('сравнение: лимит 4', () => {
  it('пятый товар не добавляется с понятным сообщением; повтор того же — не ошибка; после удаления место освобождается', () => {
    const db = setupDb();
    const ids = Array.from({ length: 5 }, () => addProduct(db));
    for (const id of ids.slice(0, 4)) compare.add(GUEST_A, id, { db, now: T0 });
    expect(MAX_COMPARE).toBe(4);

    let err: unknown;
    try {
      compare.add(GUEST_A, ids[4]!, { db, now: T0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/4 товара/);
    expect(compareCount(GUEST_A, { db })).toBe(4);

    expect(() => compare.add(GUEST_A, ids[0]!, { db, now: T0 })).not.toThrow();
    compare.remove(GUEST_A, ids[0]!, { db });
    compare.add(GUEST_A, ids[4]!, { db, now: T0 });
    expect(compare.list(GUEST_A, { db })).toEqual([ids[1], ids[2], ids[3], ids[4]]);
  });
});

describe('слияние гостя с аккаунтом при входе и регистрации', () => {
  it('вход: избранное и сравнение гостя вливаются в аккаунт без дублей, у гостя ничего не остаётся', async () => {
    const db = setupDb();
    globalRef.__rtsDb = db;
    const [a, b, c] = [addProduct(db), addProduct(db), addProduct(db)] as [number, number, number];
    const first = await register({ email: 'old@example.test', password: PASSWORD, consent: true }, { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 });
    const u = user(first.userId);
    favorites.add(u, a, { db, now: T0 });
    compare.add(u, a, { db, now: T0 });
    favorites.add(GUEST_B, a, { db, now: T0 });
    favorites.add(GUEST_B, b, { db, now: T0 + 1 });
    compare.add(GUEST_B, a, { db, now: T0 });
    compare.add(GUEST_B, c, { db, now: T0 + 1 });

    await login({ email: 'old@example.test', password: PASSWORD }, { db, cookies: fakeCookies({ [GUEST_COOKIE]: GUEST_B.guestId }), ip: '1.1.1.1', now: T0 });

    expect([...favorites.list(u, { db })].sort()).toEqual([a, b].sort());
    expect([...compare.list(u, { db })].sort()).toEqual([a, c].sort());
    expect(favorites.list(GUEST_B, { db })).toEqual([]);
    expect(compare.list(GUEST_B, { db })).toEqual([]);
  });

  it('регистрация: данные гостя переходят новому пользователю; при переполнении сравнения лишнее отбрасывается (≤4)', async () => {
    const db = setupDb();
    globalRef.__rtsDb = db;
    const ids = Array.from({ length: 4 }, () => addProduct(db));
    const extra = addProduct(db);
    for (const id of ids) compare.add(GUEST_A, id, { db, now: T0 });
    favorites.add(GUEST_A, extra, { db, now: T0 });

    const { userId } = await register({ email: 'new@example.test', password: PASSWORD, consent: true }, { db, cookies: fakeCookies({ [GUEST_COOKIE]: GUEST_A.guestId }), ip: '1.1.1.1', now: T0 });
    expect(favorites.list(user(userId), { db })).toEqual([extra]);
    expect(compare.list(user(userId), { db })).toEqual(ids);

    // прямое слияние в уже заполненное сравнение не превышает лимит
    const other = (await register({ email: 'x@example.test', password: PASSWORD, consent: true }, { db, cookies: fakeCookies(), ip: '1.1.1.1', now: T0 })).userId;
    const guestItems = [addProduct(db), addProduct(db), addProduct(db)];
    compare.add(user(other), addProduct(db), { db, now: T0 });
    compare.add(user(other), addProduct(db), { db, now: T0 });
    for (const id of guestItems) compare.add(GUEST_B, id, { db, now: T0 });
    compare.merge(GUEST_B.guestId, other, { db, now: T0 });
    expect(compare.list(user(other), { db })).toHaveLength(MAX_COMPARE);
    expect(compare.list(GUEST_B, { db })).toEqual([]);
  });
});
