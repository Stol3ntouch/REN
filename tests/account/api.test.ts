import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/server/db/connection';
import { fakeCookies } from '../auth/helpers';
import { addProduct, setupDb } from '../ordering/helpers';

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

type Route = Record<string, (r: Request) => Promise<Response>>;
const call = async (kind: 'favorites' | 'compare' | 'counters', method: string, body?: unknown, o: { origin?: string | null; query?: string } = {}) => {
  const mod = ((kind === 'favorites' ? await import('@/app/api/favorites/route') : kind === 'compare' ? await import('@/app/api/compare/route') : await import('@/app/api/counters/route')) as unknown) as Route;
  const headers: Record<string, string> = { host: 'shop.test', 'content-type': 'application/json' };
  if (o.origin !== null) headers.origin = o.origin ?? 'http://shop.test';
  const req = new Request(`http://shop.test/api/${kind}${o.query ?? ''}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return mod[method]!(req);
};

describe('API избранного и сравнения', () => {
  it('гость: POST создаёт cookie rts_guest и добавляет; GET видит; повтор не дублирует; DELETE снимает', async () => {
    const p = addProduct(db);
    const res = await call('favorites', 'POST', { productId: p });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ on: true, ids: [p], count: 1 });
    expect(jar.sets.find((s) => s.name === 'rts_guest')?.options).toMatchObject({ httpOnly: true });

    await call('favorites', 'POST', { productId: p });
    expect(await (await call('favorites', 'GET')).json()).toMatchObject({ ids: [p], count: 1 });
    expect(await (await call('favorites', 'DELETE', { productId: p })).json()).toMatchObject({ on: false, ids: [], count: 0 });
  });

  it('GET без cookie гостя не создаёт; счётчики для шапки: корзина/избранное/сравнение, с ids=1 — ещё и списки', async () => {
    const empty = await call('counters', 'GET');
    expect(await empty.json()).toEqual({ cart: 0, favorites: 0, compare: 0 });
    expect(jar.sets).toHaveLength(0);

    const a = addProduct(db);
    const b = addProduct(db);
    await call('favorites', 'POST', { productId: a });
    await call('compare', 'POST', { productId: a });
    await call('compare', 'POST', { productId: b });
    expect(await (await call('counters', 'GET')).json()).toEqual({ cart: 0, favorites: 1, compare: 2 });
    expect(await (await call('counters', 'GET', undefined, { query: '?ids=1' })).json()).toMatchObject({ favoriteIds: [a], compareIds: [a, b] });
  });

  it('сравнение: 5-й товар → 409 с понятным сообщением', async () => {
    const ids = Array.from({ length: 5 }, () => addProduct(db));
    for (const id of ids.slice(0, 4)) expect((await call('compare', 'POST', { productId: id })).status).toBe(200);
    const res = await call('compare', 'POST', { productId: ids[4] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/4 товара/);
  });

  it('ошибки: чужой Origin и отсутствие Origin → 403; не число → 400; нет товара → 404; не JSON → 400', async () => {
    const p = addProduct(db);
    expect((await call('favorites', 'POST', { productId: p }, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await call('compare', 'POST', { productId: p }, { origin: null })).status).toBe(403);
    expect((await call('favorites', 'POST', { productId: 'x' })).status).toBe(400);
    expect((await call('favorites', 'POST', { productId: 999_999 })).status).toBe(404);
    const bad = await (await import('@/app/api/compare/route')).POST(
      new Request('http://shop.test/api/compare', { method: 'POST', headers: { host: 'shop.test', origin: 'http://shop.test' }, body: 'не json' }),
    );
    expect(bad.status).toBe(400);
  });
});
