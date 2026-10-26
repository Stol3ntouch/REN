import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/catalog', useRouter: () => ({ replace: () => undefined, push: () => undefined }), redirect: () => undefined }));
vi.mock('@/server/db/connection', async (orig) => ({ ...(await orig<typeof import('@/server/db/connection')>()), getDb: () => holder.db }));

import { productListOps } from '@/app/admin/(panel)/_lib/product-list-ops';
import { ProductTable } from '@/app/admin/(panel)/catalog/ProductTable';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { parseProductListQuery } from '@/domain/catalog/products-list';
import type { Db } from '@/server/db/connection';
import { fakeCookies, T0 } from '../auth/helpers';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';
import { admin } from './helpers';

const options = { categories: [{ id: 1, label: 'Инструмент' }], brands: [{ id: 2, name: 'Champion' }] };

function render(db: Db, o: { canWrite: boolean; canDelete: boolean }) {
  const result = productListOps.list(admin, parseProductListQuery({}), { db });
  return renderToStaticMarkup(<ProductTable result={result} query={{ sort: 'date', dir: 'desc' }} params={{}} canWrite={o.canWrite} canDelete={o.canDelete} back="/admin/catalog" options={options} />);
}

function seed() {
  const db = createTestDb();
  const cat = addCategory(db, 'Инструмент', 'tools');
  addProduct(db, { name: 'Бензопила', categoryId: cat, sku: 'BP-1', priceRub: 5000, discountRub: 4500, images: ['https://champion.ru/a.jpg'], description: 'x' });
  db.prepare("UPDATE products SET short_description = 'Для сада', purchase_price_kopecks = 777700, stock_qty = 4, stock_tracked = 1").run();
  return db;
}

describe('таблица товаров: разметка и права', () => {
  it('колонки образца: фото, наименование и описание, артикул, категория, цена и старая цена, остаток, наличие, публикация, дата, действия', () => {
    const html = render(seed(), { canWrite: true, canDelete: true });
    for (const t of ['Наименование', 'Артикул', 'Категория', 'Цена', 'Остаток', 'Наличие', 'Публикация', 'Дата', 'BP-1', 'Для сада', 'В наличии']) expect(html).toContain(t);
    expect(html).toContain('src="https://champion.ru/a.jpg"');
    expect(html).toMatch(/4[\s\u00a0]500/);
    expect(html).toMatch(/<s>[^<]*5[\s ]000/);
    expect(html).toContain('role="switch"');
  });

  it('закупочной цены в таблице нет ни у кого', () => {
    const html = render(seed(), { canWrite: true, canDelete: true });
    expect(html).not.toMatch(/7[\s ]?777|закупоч/i);
  });

  it('без права записи — только чтение: нет переключателя, чекбоксов, дублирования, массовой панели', () => {
    const html = render(seed(), { canWrite: false, canDelete: false });
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Дублировать');
    expect(html).not.toContain('Удалить');
    expect(html).not.toContain('Массовые действия');
    expect(html).toContain('Открыть');
  });

  it('с правом записи, но без удаления: есть дублирование и массовые действия, нет кнопок удаления', () => {
    const html = render(seed(), { canWrite: true, canDelete: false });
    expect(html).toContain('Дублировать');
    expect(html).toContain('Применить');
    expect(html).not.toContain('Удалить');
  });

  it('удаление — с подтверждением (ConfirmButton) и только при праве удаления', () => {
    const html = render(seed(), { canWrite: false, canDelete: true });
    expect(html).toContain('Удалить');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="switch"');
  });

  it('пусто: состояние «Товаров не найдено» вместо таблицы', () => {
    const db = createTestDb();
    expect(render(db, { canWrite: true, canDelete: true })).toContain('Товаров не найдено');
  });
});

describe('маршруты /admin/api/products', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 1000);
  });
  afterEach(() => vi.useRealTimers());

  async function world() {
    const db = createTestDb();
    holder.db = db;
    const cat = addCategory(db, 'Инструмент', 'tools');
    addProduct(db, { name: 'Бензопила', categoryId: cat, priceRub: 1000 });
    addProduct(db, { name: 'Лопата', categoryId: cat, priceRub: 500 });
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const token = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const get = async (path: string, who?: string) => {
      const { GET } = path.includes('/export') ? await import('@/app/admin/api/products/export/route') : await import('@/app/admin/api/products/route');
      const cookie: Record<string, string> = who ? { cookie: `${ADMIN_SESSION_COOKIE}=${who}` } : {};
      return GET(new Request(`http://shop.test${path}`, { headers: { host: 'shop.test', ...cookie } }));
    };
    return { token, get, mgr: await token('mgr@shop.test', 'manager-password-1'), boss: await token('boss@shop.test', 'admin-password-1') };
  }

  it('список: без сессии 401; менеджер (products.read) получает {items,total,page,pageSize} без закупочной цены', async () => {
    const { get, mgr } = await world();
    expect((await get('/admin/api/products')).status).toBe(401);
    const res = await get('/admin/api/products?sort=name&dir=asc&pageSize=10', mgr);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[]; total: number; page: number; pageSize: number };
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(body.items.map((i) => i.name)).toEqual(['Бензопила', 'Лопата']);
    expect(JSON.stringify(body)).not.toMatch(/purchase/i);
  });

  it('экспорт: без сессии 401, менеджер без export.run 403; админ получает CSV с BOM и отфильтрованными строками', async () => {
    const { get, mgr, boss } = await world();
    expect((await get('/admin/api/products/export')).status).toBe(401);
    expect((await get('/admin/api/products/export', mgr)).status).toBe(403);
    const res = await get('/admin/api/products/export?q=лопата', boss);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Лопата');
    expect(text).not.toContain('Бензопила');
    expect(text).toContain('закупочная цена'); // у администратора есть products.cost
  });
});
