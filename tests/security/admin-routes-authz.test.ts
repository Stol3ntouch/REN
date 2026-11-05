import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, placeGuestOrder, seedShop, type Harness } from './harness';

/**
 * Все route handlers админки (src/app/admin/**\/route.ts) вызываются напрямую на изолированной БД:
 *  — без входа → 401/редирект, ничего не отдают;
 *  — сотрудник со своей ролью БЕЗ единого права → 403 (не 200) на каждом методе;
 *  — небезопасные методы с чужим Origin → 403 даже у суперадминистратора.
 * Список маршрутов берётся с диска: новый route.ts попадает под проверку автоматически.
 */
const ADMIN = resolve(__dirname, '../../src/app/admin');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === 'route.ts') out.push(p);
  }
  return out;
};
const routes = walk(ADMIN).map((file) => {
  const rel = relative(ADMIN, file).split(sep).join('/');
  const url = `http://shop.test/admin/${rel.replace(/\/route\.ts$/, '').replace(/\(panel\)\//, '').replace(/\[entity\]/, 'pages').replace(/\[number\]/, 'RTS-000001').replace(/\[photoId\]/, '1').replace(/\[id\]/, '1')}`;
  return { file, rel, url };
});
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const params = { entity: 'pages', number: 'RTS-000001', id: '1', photoId: '1' };
const ctx = { params: Promise.resolve(params) };

type Handler = (req: Request, ctx: unknown) => Promise<Response> | Response;
async function handlersOf(file: string): Promise<[string, Handler][]> {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  return METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler]);
}

/** Маршруты, где вход достаточен, а права применяются к содержимому ответа. */
const FILTERS_INSIDE = new Set(['api/search/route.ts']);

let h: Harness;
beforeAll(async () => {
  h = await makeHarness();
  h.attach();
}, 60_000);
afterAll(() => h?.detach());

describe('route handlers админки: защита каждого метода', () => {
  it('маршруты найдены (проверка не пустая)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(18);
  });

  for (const r of routes) {
    describe(r.rel, () => {
      it('без входа не отдаёт данных (401 или редирект на вход)', async () => {
        for (const [m, fn] of await handlersOf(r.file)) {
          const res = await fn(h.request(r.url, { method: m }), ctx);
          expect([401, 302, 303, 307, 308], `${m} без входа → ${res.status}`).toContain(res.status);
        }
      });

      it('сотрудник без единого права получает 403 (или 401/редирект), не 200', async () => {
        for (const [m, fn] of await handlersOf(r.file)) {
          if (FILTERS_INSIDE.has(r.rel)) {
            // подсказки поиска: достаточно любой сессии, а права применяются к каждой группе результатов (см. отдельный тест ниже)
            const res = await fn(h.request(r.url + '?q=%D0%B0%D0%B0', { method: m, role: 'none' }), ctx);
            expect(res.status).toBe(200);
            expect(((await res.json()) as { total: number }).total).toBe(0);
            continue;
          }
          const res = await fn(h.request(r.url, { method: m, role: 'none' }), ctx);
          expect([401, 403, 302, 303, 307, 308], `${m} роль без прав → ${res.status}`).toContain(res.status);
        }
      });

      it('небезопасный метод с чужим Origin → 403 даже у суперадминистратора', async () => {
        for (const [m, fn] of await handlersOf(r.file)) {
          if (m === 'GET') continue;
          const res = await fn(h.request(r.url, { method: m, role: 'super_admin', origin: 'https://evil.example' }), ctx);
          expect(res.status, `${m} с чужим Origin`).toBe(403);
        }
      });
    });
  }
});

describe('контроль самой проверки', () => {
  const load = async (rel: string) => (await import(/* @vite-ignore */ join(ADMIN, rel))) as Record<string, (r: Request, c: unknown) => Promise<Response>>;

  it('сессии рабочие: суперадминистратор получает 200; «только заказы» — 403 на выгрузке (нужен ещё export.run); склад — 200 на заказах и 403 на каталоге', async () => {
    const exportOrders = (await load('api/orders/export/route.ts')).GET!;
    const exportProducts = (await load('api/products/export/route.ts')).GET!;
    const url = (p: string) => `http://shop.test/admin/api/${p}/export`;
    expect((await exportOrders(h.request(url('orders'), { role: 'super_admin' }), ctx)).status).toBe(200);
    expect((await exportOrders(h.request(url('orders'), { role: 'warehouse' }), ctx)).status).toBe(200);
    expect((await exportOrders(h.request(url('orders'), { role: 'limited' }), ctx)).status).toBe(403);
    expect((await exportOrders(h.request(url('orders'), { role: 'none' }), ctx)).status).toBe(403);
    expect((await exportProducts(h.request(url('products'), { role: 'super_admin' }), ctx)).status).toBe(200);
    expect((await exportProducts(h.request(url('products'), { role: 'content_manager' }), ctx)).status).toBe(403);
  });

  it('подсказки поиска: права применяются к группам результатов', async () => {
    const { productId } = seedShop(h.db);
    const { order } = await placeGuestOrder(h.db, productId);
    const search = (await load('api/search/route.ts')).GET!;
    const q = `http://shop.test/admin/api/search?q=${order.number.slice(0, 9)}`;
    const as = async (role: string) => (await (await search(h.request(q, { role }), ctx)).json()) as { total: number; groups: { key: string }[] };
    expect((await as('limited')).groups.map((g) => g.key)).toEqual(['orders']);
    expect((await as('none')).total).toBe(0);
    expect((await as('content_manager')).total).toBe(0);
  });
});
