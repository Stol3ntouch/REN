import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/server/db/connection';
import { fakeCookies } from '../auth/helpers';
import { addProduct, setupDb } from './helpers';

// cookies() из next/headers подменяется поддельным хранилищем; БД приложения — тестовая.
let jar = fakeCookies();
vi.mock('next/headers', () => ({ cookies: async () => jar }));

const globalRef = globalThis as unknown as { __rtsDb?: Db };
let db: Db;

beforeEach(() => {
  jar = fakeCookies();
  db = setupDb();
  globalRef.__rtsDb = db;
});
afterEach(() => {
  globalRef.__rtsDb = undefined;
});

const call = async (path: string, method: string, body?: unknown, o: { origin?: string | null } = {}) => {
  const items = await import('@/app/api/cart/items/route');
  const root = await import('@/app/api/cart/route');
  const promo = await import('@/app/api/cart/promo/route');
  const url = `http://shop.test${path}`;
  const headers: Record<string, string> = { host: 'shop.test', 'content-type': 'application/json' };
  if (o.origin !== null) headers.origin = o.origin ?? 'http://shop.test';
  const req = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const handler =
    path === '/api/cart' ? root : path.startsWith('/api/cart/items') ? items : promo;
  return (handler as unknown as Record<string, (r: Request) => Promise<Response>>)[method]!(req);
};

describe('API корзины (контракт для T04: кнопка «В корзину»)', () => {
  it('POST /api/cart/items {productId, qty} → актуальная корзина {items, count, totalKopecks}; гостю ставится httpOnly cookie rts_guest', async () => {
    const p = addProduct(db, { price: 250_000, name: 'Триммер' });
    const res = await call('/api/cart/items', 'POST', { productId: p, qty: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ count: 2, totalKopecks: 500_000 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ productId: p, qty: 2, unitKopecks: 250_000, name: 'Триммер' });
    const set = jar.sets.find((s) => s.name === 'rts_guest');
    expect(set?.options).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('GET /api/cart возвращает ту же корзину (для счётчика) и не создаёт гостя', async () => {
    const empty = await call('/api/cart', 'GET');
    expect(await empty.json()).toMatchObject({ count: 0, totalKopecks: 0, items: [] });
    expect(jar.sets).toHaveLength(0);

    const p = addProduct(db);
    await call('/api/cart/items', 'POST', { productId: p, qty: 3 });
    const res = await call('/api/cart', 'GET');
    expect(await res.json()).toMatchObject({ count: 3 });
  });

  it('повторный POST суммирует до 20 и сообщает notice; цену из запроса сервер не читает', async () => {
    const p = addProduct(db, { price: 100_000 });
    await call('/api/cart/items', 'POST', { productId: p, qty: 15, price: 1, totalKopecks: 1 });
    const res = await call('/api/cart/items', 'POST', { productId: p, qty: 15 });
    const body = await res.json();
    expect(body.items[0].qty).toBe(20);
    expect(body.totalKopecks).toBe(2_000_000);
    expect(body.notice).toMatch(/20/);
  });

  it('ошибки: qty 0 / не число → 400; нет в наличии → 400; нет товара → 404; чужой Origin → 403; не JSON → 400', async () => {
    const ok = addProduct(db);
    const out = addProduct(db, { inStock: false });
    expect((await call('/api/cart/items', 'POST', { productId: ok, qty: 0 })).status).toBe(400);
    expect((await call('/api/cart/items', 'POST', { productId: ok, qty: 'many' })).status).toBe(400);
    expect((await call('/api/cart/items', 'POST', { productId: out, qty: 1 })).status).toBe(400);
    expect((await call('/api/cart/items', 'POST', { productId: 987654, qty: 1 })).status).toBe(404);
    expect((await call('/api/cart/items', 'POST', { productId: ok, qty: 1 }, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await call('/api/cart/items', 'POST', { productId: ok, qty: 1 }, { origin: null })).status).toBe(403);
    const bad = await (await import('@/app/api/cart/items/route')).POST(
      new Request('http://shop.test/api/cart/items', { method: 'POST', headers: { host: 'shop.test', origin: 'http://shop.test' }, body: '{oops' }),
    );
    expect(bad.status).toBe(400);
  });

  it('PATCH меняет количество, DELETE убирает позицию', async () => {
    const p = addProduct(db, { price: 10_000 });
    await call('/api/cart/items', 'POST', { productId: p, qty: 1 });
    expect((await (await call('/api/cart/items', 'PATCH', { productId: p, qty: 5 })).json()).totalKopecks).toBe(50_000);
    expect((await (await call('/api/cart/items', 'DELETE', { productId: p })).json()).count).toBe(0);
  });

  it('POST /api/cart/promo: плохой код — 200 с текстом error и целой корзиной; хороший — со скидкой', async () => {
    const p = addProduct(db, { price: 100_000 });
    await call('/api/cart/items', 'POST', { productId: p, qty: 1 });
    db.prepare("INSERT INTO promos (code, type, value, created_at, updated_at) VALUES ('GOOD', 'percent', 10, 1, 1)").run();
    const bad = await (await call('/api/cart/promo', 'POST', { code: 'NOPE' })).json();
    expect(bad.error).toMatch(/нет/i);
    expect(bad.items).toHaveLength(1);
    const good = await (await call('/api/cart/promo', 'POST', { code: 'good' })).json();
    expect(good).toMatchObject({ discountKopecks: 10_000, totalKopecks: 90_000, promo: { code: 'GOOD' } });
    expect((await (await call('/api/cart/promo', 'DELETE')).json()).promo).toBeNull();
  });
});
