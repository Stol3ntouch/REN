import { describe, expect, it, vi } from 'vitest';
import { createSearchHandler, SEARCH_RATE_LIMIT } from '@/app/admin/api/search/handler';
import { globalSearch, SEARCH_MAX_TOTAL, SEARCH_PER_TYPE } from '@/domain/admin/search';
import type { Permission, StaffSession } from '@/domain/admin/permissions';
import { ftsQuery } from '@/server/db/repositories/search-admin';
import { createTestDb } from '@/server/db/testing';
import { UnauthorizedError } from '@/server/http/errors';
import { ms, seedOctober } from '../analytics/helpers';
import { req, staffCookies, T0 } from '../analytics/staff-cookies';
import { admin } from './helpers';

const only = (...permissions: Permission[]): StaffSession => ({ staffId: 9, email: 'x@shop.test', name: null, role: 'custom', permissions });

function seedAll() {
  const db = createTestDb();
  seedOctober(db);
  db.prepare("UPDATE products SET sku = 'HT-625R', barcode = '4600000000017' WHERE name = 'Генератор A'").run();
  db.prepare("UPDATE orders SET contact_name = 'Пётр Сидоров', contact_email = 'petr@example.test', contact_phone = '+7 (900) 555-44-33', phone_digits = '79005554433' WHERE number = 'RTS-000001'").run();
  db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('petr.client@example.test', 'h', 1)").run();
  const uid = Number((db.prepare("SELECT id FROM users WHERE email = 'petr.client@example.test'").get() as { id: number }).id);
  db.prepare("INSERT INTO user_profiles (user_id, name, phone, updated_at) VALUES (?, 'Пётр Клиентов', '+7 900 555-44-33', 1)").run(uid);
  const at = ms('2026-10-12T12:00:00+03:00');
  db.prepare("INSERT INTO requests (number, kind, status, name, phone, created_at, updated_at) VALUES ('MSG-7', 'contact', 'new', 'Пётр Писатель', '+7 900 555-44-33', ?, ?)").run(at, at);
  db.prepare("INSERT INTO requests (number, kind, status, name, created_at, updated_at) VALUES ('REM-9', 'repair', 'new', 'Пётр Ремонтник', ?, ?)").run(at, at);
  return { db, uid };
}

describe('глобальный поиск: что находит', () => {
  it('товары: по названию (без учёта регистра), артикулу с разделителями, штрихкоду; префикс слова', () => {
    const { db } = seedAll();
    const titles = (q: string) => globalSearch(admin, q, { db }).groups.find((g) => g.key === 'products')?.items.map((i) => i.title) ?? [];
    expect(titles('генератор')).toEqual(['Генератор A']);
    expect(titles('ГЕНЕР')).toEqual(['Генератор A']);
    expect(titles('ht 625r')).toEqual(['Генератор A']);
    expect(titles('HT625R')).toEqual(['Генератор A']);
    expect(titles('4600000000017')).toEqual(['Генератор A']);
    expect(titles('несуществующий')).toEqual([]);
  });

  it('категории, заказы (номер, email, телефон по цифрам), клиенты, обращения — ссылки на объекты', () => {
    const { db, uid } = seedAll();
    const r = globalSearch(admin, 'петр', { db });
    expect(r.groups.map((g) => g.key)).toEqual(['customers', 'inquiries']); // «петр» ≠ «пётр»: ё не равно е только в имени заказа
    const byKey = (q: string, key: string) => globalSearch(admin, q, { db }).groups.find((g) => g.key === key)?.items ?? [];
    expect(byKey('триммер', 'products')[0]?.href).toMatch(/^\/admin\/catalog\/\d+$/);
    expect(byKey('триммеры', 'categories')[0]).toMatchObject({ title: 'Триммеры', href: expect.stringMatching(/^\/admin\/catalog\/categories\/\d+$/) });
    expect(byKey('RTS-000001', 'orders')[0]).toMatchObject({ title: 'Заказ RTS-000001', href: '/admin/orders/RTS-000001' });
    expect(byKey('rts-000001', 'orders')).toHaveLength(1);
    expect(byKey('PETR@example', 'orders')[0]?.href).toBe('/admin/orders/RTS-000001');
    expect(byKey('+7 900 555 44 33', 'orders')).toHaveLength(1);
    expect(byKey('5554433', 'customers')[0]?.href).toBe(`/admin/customers/${uid}`);
    expect(byKey('MSG-7', 'inquiries')[0]?.href).toMatch(/^\/admin\/inquiries\/\d+$/);
    expect(byKey('Ремонтник', 'inquiries')).toEqual([]); // ремонт — не обращение
  });
});

describe('глобальный поиск: права', () => {
  it('менеджер без customers.read не получает клиентов, и запрос к таблице клиентов не выполняется', () => {
    const { db } = seedAll();
    const noCustomers = only('products.read', 'orders.read', 'inquiries.read');
    const r = globalSearch(noCustomers, 'петр', { db });
    expect(r.groups.map((g) => g.key)).not.toContain('customers');
    expect(JSON.stringify(r)).not.toContain('petr.client');
    const spy = vi.spyOn(db, 'prepare');
    globalSearch(noCustomers, 'петр', { db });
    expect(spy.mock.calls.map((c) => String(c[0])).some((sql) => /\busers\b/.test(sql))).toBe(false);
  });

  it('каждый тип открывается только своим правом', () => {
    const { db } = seedAll();
    expect(globalSearch(only('orders.read'), 'rts', { db }).groups.map((g) => g.key)).toEqual(['orders']);
    expect(globalSearch(only('products.read'), 'генератор', { db }).groups.map((g) => g.key)).toEqual(['products', 'categories']);
    expect(globalSearch(only('products.read'), 'триммеры', { db }).groups.map((g) => g.key)).toEqual(['categories']);
    expect(globalSearch(only('customers.read'), 'клиентов', { db }).groups.map((g) => g.key)).toEqual(['customers']);
    expect(globalSearch(only('inquiries.read'), 'писатель', { db }).groups.map((g) => g.key)).toEqual(['inquiries']);
    expect(globalSearch(only('staff.self'), 'петр', { db })).toMatchObject({ groups: [], total: 0 });
  });

  it('аноним → 401', () => {
    expect(() => globalSearch(null, 'abc', { db: createTestDb() })).toThrow(UnauthorizedError);
  });
});

describe('глобальный поиск: лимиты и спецсимволы', () => {
  it('минимум 2 символа; не больше 5 на тип и 25 всего', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(globalSearch(admin, 'г', { db })).toMatchObject({ groups: [], total: 0 });
    expect(globalSearch(admin, '  ', { db }).total).toBe(0);
    for (let i = 0; i < 12; i++) {
      db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, 'h', 1)").run(`bulk${i}@example.test`);
      db.prepare("INSERT INTO requests (number, kind, status, name, created_at, updated_at) VALUES (?, 'contact', 'new', 'Bulk', 1, 1)").run(`BLK-${i}`);
      db.prepare("INSERT INTO categories (external_id, name, slug) VALUES (?, ?, ?)").run(`bk${i}`, `Bulk категория ${i}`, `bulk-${i}`);
    }
    const r = globalSearch(admin, 'bulk', { db });
    expect(r.groups.length).toBeGreaterThanOrEqual(3);
    for (const g of r.groups) expect(g.items.length).toBeLessThanOrEqual(SEARCH_PER_TYPE);
    expect(r.total).toBeLessThanOrEqual(SEARCH_MAX_TOTAL);
  });

  it('синтаксис FTS и LIKE экранируется: кавычки, звёздочки, AND/OR, % и _ не ломают запрос и не расширяют поиск', () => {
    const { db } = seedAll();
    for (const q of ['"', 'ген*', 'генератор AND', 'NOT генератор', '(генератор', 'a:b', 'генератор OR 1=1 --', "'; DROP TABLE products; --", '^ген', '%', '_', '\\', 'ген" OR "']) {
      expect(() => globalSearch(admin, q, { db })).not.toThrow();
    }
    expect(globalSearch(admin, '%%', { db }).total).toBe(0); // % — не «любая строка»
    expect(globalSearch(admin, '__', { db }).total).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(2);
    expect(ftsQuery('генератор OR "x" AND (y)*')).toBe('"генератор"* "or"* "x"* "and"* "y"*');
    expect(ftsQuery('***')).toBeNull();
  });

  it('таймаут: исчерпанный бюджет прекращает опрос оставшихся типов и помечает ответ partial', () => {
    const { db } = seedAll();
    let t = 0;
    const r = globalSearch(admin, 'генератор', { db, now: () => (t += 1000), timeoutMs: 1500 });
    expect(r.partial).toBe(true);
    expect(r.groups.length).toBeLessThan(5);
  });
});

describe('GET /admin/api/search', () => {
  it('без входа 401; администратор получает группы; ограничение частоты → 429', async () => {
    const { db } = seedAll();
    const c = await staffCookies(db);
    const h = createSearchHandler({ db, now: T0 });
    const url = (q: string) => `http://shop.test/admin/api/search?q=${encodeURIComponent(q)}`;
    expect((await h(req(url('генератор')))).status).toBe(401);
    const ok = await h(req(url('генератор'), { cookie: c.admin }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).groups[0]).toMatchObject({ key: 'products' });
    expect((await h(req(url('г'), { cookie: c.admin }))).status).toBe(200);
    for (let i = 0; i < SEARCH_RATE_LIMIT; i++) await h(req(url('ген'), { cookie: c.manager }));
    const limited = await h(req(url('ген'), { cookie: c.manager }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});
