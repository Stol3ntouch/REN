import { describe, expect, it } from 'vitest';
import { brandOps } from '@/app/admin/(panel)/_lib/brands-ops';
import { MAX_BULK, productListOps } from '@/app/admin/(panel)/_lib/product-list-ops';
import { productOps } from '@/app/admin/(panel)/_lib/product-ops';
import { listBack } from '@/app/admin/(panel)/catalog/products/list/back';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { csvCell, exportLine, parseProductListQuery, type ProductListQuery } from '@/domain/catalog/products-list';
import type { Db } from '@/server/db/connection';
import { ordersRepo } from '@/server/db/repositories/orders';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';
import { rawOrder } from '../ordering/helpers';
import { admin, manager, T0 } from './helpers';

const S = (role: string, permissions: StaffSession['permissions']): StaffSession => ({ staffId: 7, email: `${role}@shop.test`, name: role, role, permissions });
/** Читает, правит, но не удаляет и не выгружает. */
const editor = S('editor', ['products.read', 'products.write']);
const deleter = S('deleter', ['products.read', 'products.delete']);
const exporter = S('exporter', ['products.read', 'export.run']);
const costExporter = S('costexp', ['products.read', 'export.run', 'products.cost']);

const o = (db: Db) => ({ db, now: T0 });
const q = (sp: Record<string, string> = {}): ProductListQuery => parseProductListQuery(sp);

function shop() {
  const db = createTestDb();
  const tools = addCategory(db, 'Инструмент', 'tools');
  const saws = addCategory(db, 'Пилы', 'saws', tools);
  const garden = addCategory(db, 'Сад', 'garden');
  return { db, tools, saws, garden };
}

const col = (db: Db, id: number, name: string) => (db.prepare(`SELECT ${name} AS v FROM products WHERE id = ?`).get(id) as { v: unknown }).v;

describe('разбор адреса списка', () => {
  it('значения по умолчанию и защита от мусора', () => {
    expect(q()).toMatchObject({ page: 1, pageSize: 20, sort: 'date', dir: 'desc' });
    expect(q({ pageSize: '7', page: '-3', sort: 'drop table', category: 'x', priceMin: 'abc' })).toMatchObject({ page: 1, pageSize: 20, sort: 'date' });
    const f = q({ q: ' пила ', category: '5', brand: '2', availability: 'preorder', published: '0', hidden: '1', priceMin: '1 000,50', priceMax: '2000', new: '1', featured: '1', promo: '1', pageSize: '50', sort: 'price', dir: 'asc' });
    expect(f).toMatchObject({ q: 'пила', categoryId: 5, brandId: 2, availability: 'preorder', published: false, hidden: true, priceMinKopecks: 100_050, priceMaxKopecks: 200_000, isNew: true, featured: true, isPromo: true, pageSize: 50, sort: 'price', dir: 'asc' });
    expect(q({ availability: 'bogus' }).availability).toBeUndefined();
  });

  it('возврат после действия: только внутренний список, следы результата убираются', () => {
    expect(listBack('/admin/catalog?q=a&ok=1&error=x&done=y&page=2')).toBe('/admin/catalog?q=a&page=2');
    expect(listBack('https://evil.test')).toBe('/admin/catalog');
    expect(listBack('//evil.test')).toBe('/admin/catalog');
    expect(listBack('/admin/catalog-evil?a=1')).toBe('/admin/catalog');
    expect(listBack('')).toBe('/admin/catalog');
  });
});

describe('серверный список: фильтры, сортировка, страница', () => {
  it('поиск по названию (без учёта регистра и ё), артикулу и штрихкоду; спецсимволы LIKE не шаблон', () => {
    const { db, tools } = shop();
    const a = addProduct(db, { name: 'Бензопила Ёлка', categoryId: tools, sku: 'BP-1' });
    const b = addProduct(db, { name: 'Триммер', categoryId: tools, sku: 'TR-2' });
    db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run('4600001', b);
    const names = (sp: Record<string, string>) => productListOps.list(admin, q(sp), o(db)).items.map((r) => r.id);
    expect(names({ q: 'ЕЛКА' })).toEqual([a]);
    expect(names({ q: 'bp-1' })).toEqual([a]);
    expect(names({ q: '4600001' })).toEqual([b]);
    expect(names({ q: '100%' })).toEqual([]);
    expect(names({ q: '_' })).toEqual([]);
  });

  it('категория включает подкатегории и дополнительные категории', () => {
    const { db, tools, saws, garden } = shop();
    const inTools = addProduct(db, { name: 'Молоток', categoryId: tools });
    const inSaws = addProduct(db, { name: 'Пила', categoryId: saws });
    const extra = addProduct(db, { name: 'Секатор', categoryId: garden });
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(extra, saws);
    const ids = productListOps.list(admin, q({ category: String(tools) }), o(db)).items.map((r) => r.id).sort();
    expect(ids).toEqual([inTools, inSaws, extra].sort());
    expect(productListOps.list(admin, q({ category: String(garden) }), o(db)).total).toBe(1);
  });

  it('бренд, наличие, публикация, скрытие, цена (по цене к оплате), признаки', async () => {
    const { db, tools } = shop();
    const brand = (await brandOps.create(admin, { name: 'Champion', slug: '', description: '', siteUrl: '', published: true, sort: 0, seoTitle: '', seoDescription: '' }, undefined, o(db))).id;
    const a = addProduct(db, { name: 'А', categoryId: tools, priceRub: 1000 });
    const b = addProduct(db, { name: 'Б', categoryId: tools, priceRub: 5000, discountRub: 900 });
    const c = addProduct(db, { name: 'В', categoryId: tools, priceRub: 3000, published: false });
    db.prepare('UPDATE products SET brand_id = ?, is_new = 1 WHERE id = ?').run(brand, a);
    db.prepare("UPDATE products SET availability = 'preorder', featured = 1 WHERE id = ?").run(b);
    db.prepare('UPDATE products SET hidden_by_admin = 1, is_promo = 1 WHERE id = ?').run(c);
    const ids = (sp: Record<string, string>) => productListOps.list(admin, q({ sort: 'name', dir: 'asc', ...sp }), o(db)).items.map((r) => r.id);
    expect(ids({ brand: String(brand) })).toEqual([a]);
    expect(ids({ availability: 'preorder' })).toEqual([b]);
    expect(ids({ published: '0' })).toEqual([c]);
    expect(ids({ hidden: '1' })).toEqual([c]);
    expect(ids({ hidden: '0' })).toEqual([a, b]);
    expect(ids({ priceMax: '950' })).toEqual([b]); // скидочная 900 ₽ — цена к оплате
    expect(ids({ priceMin: '2000', priceMax: '3000' })).toEqual([c]);
    expect(ids({ new: '1' })).toEqual([a]);
    expect(ids({ featured: '1' })).toEqual([b]);
    expect(ids({ promo: '1' })).toEqual([c]);
  });

  it('сортировка по названию/цене/дате/остатку/категории и страницы; ответ {items,total,page,pageSize}', () => {
    const { db, tools, garden } = shop();
    const a = addProduct(db, { name: 'Яблоня', categoryId: garden, priceRub: 300 });
    const b = addProduct(db, { name: 'арбуз', categoryId: tools, priceRub: 100 });
    const c = addProduct(db, { name: 'Берёза', categoryId: tools, priceRub: 200 });
    db.prepare('UPDATE products SET stock_qty = ?, stock_tracked = 1, updated_at = ? WHERE id = ?').run(5, '2026-01-01T00:00:00.000Z', a);
    db.prepare('UPDATE products SET stock_qty = ?, stock_tracked = 1, updated_at = ? WHERE id = ?').run(1, '2026-03-01T00:00:00.000Z', b);
    db.prepare('UPDATE products SET stock_qty = ?, stock_tracked = 1, updated_at = ? WHERE id = ?').run(9, '2026-02-01T00:00:00.000Z', c);
    const order = (sort: string, dir: string) => productListOps.list(admin, q({ sort, dir }), o(db)).items.map((r) => r.id);
    expect(order('name', 'asc')).toEqual([b, c, a]); // регистр и ё не ломают порядок
    expect(order('price', 'desc')).toEqual([a, c, b]);
    expect(order('date', 'desc')).toEqual([b, c, a]);
    expect(order('stock', 'desc')).toEqual([c, a, b]);
    expect(order('category', 'asc').slice(-1)).toEqual([a]); // «Инструмент» раньше «Сад»
    const p2 = productListOps.list(admin, q({ sort: 'name', dir: 'asc', pageSize: '10' }), o(db));
    expect(Object.keys(p2).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    const tiny = { ...q({ sort: 'name', dir: 'asc' }), pageSize: 2, page: 2 };
    const second = productListOps.list(admin, tiny, o(db));
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.items.map((r) => r.id)).toEqual([a]);
    expect(productListOps.list(admin, { ...tiny, page: 99 }, o(db)).page).toBe(2); // за пределами — последняя страница
  });

  it('в строках нет закупочной цены и нет лишних полей', () => {
    const { db, tools } = shop();
    const id = addProduct(db, { name: 'Пила', categoryId: tools });
    db.prepare('UPDATE products SET purchase_price_kopecks = 123456 WHERE id = ?').run(id);
    const json = JSON.stringify(productListOps.list(editor, q(), o(db)));
    expect(json).not.toMatch(/purchase|123456/i);
  });

  it('фото: первое по порядку, локальная копия приоритетнее ссылки', () => {
    const { db, tools } = shop();
    const id = addProduct(db, { name: 'Пила', categoryId: tools, images: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'] });
    const bare = addProduct(db, { name: 'Без фото', categoryId: tools });
    const items = productListOps.list(admin, q(), o(db)).items;
    expect(items.find((r) => r.id === id)?.image?.src).toBe('https://champion.ru/a.jpg');
    expect(items.find((r) => r.id === bare)?.image).toBeNull();
  });
});

describe('список на большом каталоге: число запросов и индексы', () => {
  const N = 1214;
  function big() {
    const { db, tools, saws } = shop();
    db.exec('BEGIN');
    for (let i = 0; i < N; i++) addProduct(db, { name: `Товар ${i}`, categoryId: i % 2 ? tools : saws, priceRub: 100 + i, images: [`https://champion.ru/${i}-1.jpg`, `https://champion.ru/${i}-2.jpg`] });
    db.exec('COMMIT');
    return { db, tools };
  }
  /** Считает SQL-запросы, выполненные через db.prepare. */
  function counted<T>(db: Db, fn: () => T): { value: T; sqls: string[] } {
    const sqls: string[] = [];
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: unknown }).prepare = (sql: string) => {
      sqls.push(sql);
      return orig(sql);
    };
    try {
      return { value: fn(), sqls };
    } finally {
      (db as unknown as { prepare: unknown }).prepare = orig;
    }
  }

  it('страница из 1214 товаров открывается не более чем 4 SQL-запросами и возвращает только свою страницу', () => {
    const { db, tools } = big();
    for (const sp of [{} as Record<string, string>, { category: String(tools), sort: 'price', dir: 'asc' }, { q: 'Товар 77', published: '1' }]) {
      const { value, sqls } = counted(db, () => productListOps.list(admin, q(sp), o(db)));
      expect(sqls.length).toBeLessThanOrEqual(4);
      expect(value.items.length).toBeLessThanOrEqual(20);
      expect(value.total).toBeGreaterThan(0);
    }
    expect(productListOps.list(admin, q(), o(db)).total).toBe(N);
  });

  it('первое фото берётся по индексу (product_id, sort), таблица фото целиком не читается', () => {
    const { db } = big();
    const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT i2.id FROM product_images i2 WHERE i2.product_id = 5 ORDER BY i2.sort, i2.id LIMIT 1").all() as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toMatch(/idx_product_images_product/);
    expect(plan).not.toMatch(/SCAN product_images/);
    const page = productListOps.list(admin, q({ pageSize: '10' }), o(db));
    expect(page.items.every((r) => r.image !== null)).toBe(true);
  });
});

describe('права на чтение и изменение списка', () => {
  it('без сессии — 401; без права чтения — 403', () => {
    const { db } = shop();
    expect(() => productListOps.list(null, q(), o(db))).toThrow(UnauthorizedError);
    expect(() => productListOps.list(S('none', []), q(), o(db))).toThrow(ForbiddenError);
  });

  it('менеджер видит список, но не меняет: массово, дублированием, удалением, выгрузкой — 403 и данные целы', async () => {
    const { db, tools } = shop();
    const id = addProduct(db, { name: 'Пила', categoryId: tools });
    expect(productListOps.list(manager, q(), o(db)).total).toBe(1);
    expect(() => productListOps.bulk(manager, { type: 'unpublish' }, { ids: [id] }, o(db))).toThrow(ForbiddenError);
    expect(() => productListOps.duplicate(manager, id, o(db))).toThrow(ForbiddenError);
    expect(() => productListOps.bulkRemove(manager, { ids: [id] }, o(db))).toThrow(ForbiddenError);
    expect(() => productListOps.exportCsv(manager, {}, o(db))).toThrow(ForbiddenError);
    await expect(productOps.setVisibility(manager, id, { published: false }, o(db))).rejects.toBeInstanceOf(ForbiddenError);
    expect(col(db, id, 'published')).toBe(1);
    expect(audit.list({ entity: 'product' }, { db })).toEqual([]);
  });

  it('правка без права удаления: массовое удаление — 403; удаляющий без правки не меняет', () => {
    const { db, tools } = shop();
    const id = addProduct(db, { name: 'Пила', categoryId: tools });
    expect(() => productListOps.bulkRemove(editor, { ids: [id] }, o(db))).toThrow(ForbiddenError);
    expect(() => productListOps.bulk(deleter, { type: 'hide' }, { ids: [id] }, o(db))).toThrow(ForbiddenError);
    expect(col(db, id, 'hidden_by_admin')).toBe(0);
  });
});

describe('массовые действия', () => {
  function three() {
    const w = shop();
    const ids = [1, 2, 3].map((n) => addProduct(w.db, { name: `Т${n}`, categoryId: w.tools }));
    return { ...w, ids };
  }

  it('снятие и возврат публикации: отчёт изменено/пропущено, повтор идемпотентен, одна запись аудита с числом', () => {
    const { db, ids } = three();
    db.prepare('UPDATE products SET published = 0 WHERE id = ?').run(ids[0]!);
    const r1 = productListOps.bulk(editor, { type: 'unpublish' }, { ids }, o(db));
    expect(r1).toEqual({ total: 3, changed: 2, skipped: 1, errors: [] });
    expect(ids.map((i) => col(db, i, 'published'))).toEqual([0, 0, 0]);
    const r2 = productListOps.bulk(editor, { type: 'unpublish' }, { ids }, o(db));
    expect(r2).toMatchObject({ changed: 0, skipped: 3 });
    const rows = audit.list({ action: 'product.bulk' }, { db });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.after)).toContainEqual(expect.objectContaining({ total: 3, changed: 2, skipped: 1, scope: 'ids', action: { type: 'unpublish' } }));
    productListOps.bulk(editor, { type: 'publish' }, { ids }, o(db));
    expect(ids.map((i) => col(db, i, 'published'))).toEqual([1, 1, 1]);
  });

  it('ручное изменение закрепляется за ручной правкой (импорт не откатит)', () => {
    const { db, ids } = three();
    productListOps.bulk(editor, { type: 'unpublish' }, { ids: [ids[0]!] }, o(db));
    expect(JSON.parse(String(col(db, ids[0]!, 'locked_fields')))).toContain('published');
    productListOps.bulk(editor, { type: 'hide' }, { ids: [ids[1]!] }, o(db));
    expect(col(db, ids[1]!, 'hidden_by_admin')).toBe(1);
    expect(col(db, ids[1]!, 'published')).toBe(1);
  });

  it('перемещение в основную категорию синхронизирует product_categories; дополнительная добавляется один раз', () => {
    const { db, ids, garden, tools } = three();
    const r = productListOps.bulk(editor, { type: 'move', categoryId: garden }, { ids }, o(db));
    expect(r.changed).toBe(3);
    for (const id of ids) {
      expect(col(db, id, 'category_id')).toBe(garden);
      const cats = db.prepare('SELECT category_id, is_primary FROM product_categories WHERE product_id = ? ORDER BY category_id').all(id) as { category_id: number; is_primary: number }[];
      expect(cats).toEqual([{ category_id: garden, is_primary: 1 }]);
    }
    const add = productListOps.bulk(editor, { type: 'addCategory', categoryId: tools }, { ids }, o(db));
    expect(add).toMatchObject({ changed: 3, skipped: 0 });
    expect(productListOps.bulk(editor, { type: 'addCategory', categoryId: tools }, { ids }, o(db))).toMatchObject({ changed: 0, skipped: 3 });
    expect(productListOps.bulk(editor, { type: 'addCategory', categoryId: garden }, { ids }, o(db))).toMatchObject({ changed: 0, skipped: 3 }); // уже основная
  });

  it('бренд и признаки', async () => {
    const { db, ids } = three();
    const brand = (await brandOps.create(admin, { name: 'Huter', slug: '', description: '', siteUrl: '', published: true, sort: 0, seoTitle: '', seoDescription: '' }, undefined, o(db))).id;
    expect(productListOps.bulk(editor, { type: 'brand', brandId: brand }, { ids }, o(db)).changed).toBe(3);
    expect(ids.map((i) => col(db, i, 'brand_id'))).toEqual([brand, brand, brand]);
    expect(productListOps.bulk(editor, { type: 'brand', brandId: null }, { ids: [ids[0]!] }, o(db)).changed).toBe(1);
    expect(col(db, ids[0]!, 'brand_id')).toBeNull();
    productListOps.bulk(editor, { type: 'flag', flag: 'isNew', value: true }, { ids }, o(db));
    productListOps.bulk(editor, { type: 'flag', flag: 'featured', value: true }, { ids: [ids[1]!] }, o(db));
    productListOps.bulk(editor, { type: 'flag', flag: 'isPromo', value: true }, { ids: [ids[2]!] }, o(db));
    expect(ids.map((i) => [col(db, i, 'is_new'), col(db, i, 'featured'), col(db, i, 'is_promo')])).toEqual([
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 1],
    ]);
  });

  it('ошибка в данных откатывает всё: нет такой категории — ничего не изменилось, аудита нет', () => {
    const { db, ids } = three();
    expect(() => productListOps.bulk(editor, { type: 'move', categoryId: 9999 }, { ids }, o(db))).toThrow(ValidationError);
    expect(() => productListOps.bulk(editor, { type: 'brand', brandId: 9999 }, { ids }, o(db))).toThrow(ValidationError);
    expect(() => productListOps.bulk(editor, { type: 'bogus' }, { ids }, o(db))).toThrow(ValidationError);
    expect(() => productListOps.bulk(editor, { type: 'hide' }, { ids: [] }, o(db))).toThrow(ValidationError);
    expect(ids.map((i) => col(db, i, 'hidden_by_admin'))).toEqual([0, 0, 0]);
    expect(audit.list({ action: 'product.bulk' }, { db })).toEqual([]);
  });

  it('несуществующий id попадает в ошибки, остальные меняются', () => {
    const { db, ids } = three();
    const r = productListOps.bulk(editor, { type: 'hide' }, { ids: [ids[0]!, 99999] }, o(db));
    expect(r).toMatchObject({ total: 2, changed: 1, skipped: 0 });
    expect(r.errors).toEqual([{ id: 99999, message: 'Товар не найден' }]);
  });

  it('«все по фильтру»: число сверяется, лимит 5000, в аудите — фильтр', () => {
    const { db, ids, garden } = three();
    productListOps.bulk(editor, { type: 'move', categoryId: garden }, { ids: [ids[2]!] }, o(db));
    const filter = { categoryId: garden };
    expect(() => productListOps.bulk(editor, { type: 'hide' }, { filter, expectedTotal: 5 }, o(db))).toThrow(ConflictError);
    expect(col(db, ids[2]!, 'hidden_by_admin')).toBe(0);
    expect(() => productListOps.bulk(editor, { type: 'hide' }, { filter: { categoryId: 99999 }, expectedTotal: 0 }, o(db))).toThrow(ValidationError);
    const r = productListOps.bulk(editor, { type: 'hide' }, { filter, expectedTotal: 1 }, o(db));
    expect(r.changed).toBe(1);
    expect(col(db, ids[2]!, 'hidden_by_admin')).toBe(1);
    expect(col(db, ids[0]!, 'hidden_by_admin')).toBe(0);
    const a = audit.list({ action: 'product.bulk' }, { db }).find((r) => (r.after as { scope?: string }).scope === 'filter')!.after;
    expect(a).toMatchObject({ scope: 'filter', filter: { category: String(garden) }, total: 1 });
  });

  it('больше 5000 за раз отклоняется', () => {
    const { db } = shop();
    const many = Array.from({ length: MAX_BULK + 1 }, (_, i) => i + 1);
    expect(() => productListOps.bulk(editor, { type: 'hide' }, { ids: many }, o(db))).toThrow(ValidationError);
  });
});

describe('дублирование', () => {
  it('копия скрыта, без остатка и артикула, со своим slug; категории, характеристики и фото скопированы; исходный цел', () => {
    const { db, tools, garden } = shop();
    const src = addProduct(db, { name: 'Бензопила', slug: 'benzopila', sku: 'BP-1', categoryId: tools, priceRub: 4500, attrs: { Вес: '5', Тип: 'бензин' }, images: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'] });
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(src, garden);
    db.prepare("UPDATE products SET barcode = '123', stock_qty = 7, stock_tracked = 1, featured = 1, purchase_price_kopecks = 100 WHERE id = ?").run(src);
    const copy = productListOps.duplicate(editor, src, o(db));
    expect(copy.slug).toBe('benzopila-copy');
    expect(col(db, copy.id, 'published')).toBe(0);
    expect(col(db, copy.id, 'sku')).toBeNull();
    expect(col(db, copy.id, 'barcode')).toBeNull();
    expect(col(db, copy.id, 'stock_qty')).toBe(0);
    expect(col(db, copy.id, 'price_kopecks')).toBe(450_000);
    expect(col(db, copy.id, 'featured')).toBe(1);
    expect(String(col(db, copy.id, 'name'))).toContain('Бензопила');
    const n = (table: string, id: number) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE product_id = ?`).get(id) as { n: number }).n;
    expect(n('product_attributes', copy.id)).toBe(2);
    expect(n('product_images', copy.id)).toBe(2);
    expect(n('product_categories', copy.id)).toBe(2);
    expect(col(db, src, 'sku')).toBe('BP-1');
    expect(col(db, src, 'stock_qty')).toBe(7);
    expect(n('product_images', src)).toBe(2);
    expect(productListOps.duplicate(editor, src, o(db)).slug).toBe('benzopila-copy-2');
    expect(audit.list({ action: 'product.duplicate' }, { db })).toHaveLength(2);
  });

  it('несуществующий товар — 404', () => {
    const { db } = shop();
    expect(() => productListOps.duplicate(editor, 99999, o(db))).toThrow(/не найден/);
  });
});

describe('удаление', () => {
  function withOrder(db: Db, productId: number) {
    const { id } = rawOrder(db, 'new');
    ordersRepo.insertItem(db, id, { productId, name: 'Снимок', sku: 'S', priceKopecks: 100, discountPriceKopecks: null, unitKopecks: 100, qty: 1, lineKopecks: 100 });
  }

  it('массовое удаление: товары с заказами пропускаются с причиной, остальные удаляются, одна запись аудита', () => {
    const { db, tools } = shop();
    const free = addProduct(db, { name: 'Свободный', categoryId: tools, images: ['https://champion.ru/a.jpg'] });
    const used = addProduct(db, { name: 'В заказе', categoryId: tools });
    withOrder(db, used);
    const r = productListOps.bulkRemove(deleter, { ids: [free, used] }, o(db));
    expect(r).toMatchObject({ total: 2, changed: 1, skipped: 1 });
    expect(r.errors[0]?.message).toMatch(/В заказе.*заказ.*скройте/s);
    expect(db.prepare('SELECT id FROM products').all()).toEqual([{ id: used }]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM product_images').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT name FROM order_items').get() as { name: string }).name).toBe('Снимок');
    const log = audit.list({ action: 'product.bulk_delete' }, { db });
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toMatchObject({ deleted: 1, skipped: 1, total: 2 });
  });

  it('единичное удаление: при заказах отказ с подсказкой скрыть (правила C04)', async () => {
    const { db, tools } = shop();
    const used = addProduct(db, { name: 'В заказе', categoryId: tools });
    withOrder(db, used);
    await expect(productOps.remove(deleter, used, o(db))).rejects.toThrow(/скрыт/i);
  });
});

describe('экспорт CSV', () => {
  async function drain(db: Db, session: StaffSession, filter = {}) {
    const { chunks, total } = productListOps.exportCsv(session, filter, o(db));
    return { text: [...chunks].join(''), total };
  }

  it('BOM, разделитель «;», нужные колонки, только отфильтрованные товары; закупочной нет без права', async () => {
    const { db, tools, garden } = shop();
    addProduct(db, { name: 'Пила "Дружба"; 2', slug: 'pila', sku: 'P-1', categoryId: tools, priceRub: 1500.5 });
    addProduct(db, { name: 'Лопата', slug: 'lopata', categoryId: garden, published: false });
    db.prepare('UPDATE products SET purchase_price_kopecks = 99900').run();
    const all = await drain(db, exporter);
    expect(all.text.startsWith('﻿')).toBe(true);
    expect(all.total).toBe(2);
    const lines = all.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('id;артикул;название;категория;бренд;цена;старая цена;остаток;наличие;публикация;slug');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Пила ""Дружба""; 2"');
    expect(lines[1]).toContain(';1500,50;');
    expect(all.text).not.toContain('999,00');
    const filtered = await drain(db, exporter, { published: false });
    expect(filtered.text).toContain('Лопата');
    expect(filtered.text).not.toContain('Пила');
    expect(filtered.text).toContain('снят с публикации');
    const withCost = await drain(db, costExporter);
    expect(withCost.text.split('\r\n')[0]).toMatch(/;закупочная цена$/);
    expect(withCost.text).toContain('999,00');
  });

  it('формулы обезврежены апострофом', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+7 900')).toBe("'+7 900");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('обычный')).toBe('обычный');
    const line = exportLine({ id: 1, sku: '=1+1', name: '@x', categoryName: 'К', brandName: null, priceKopecks: 100, oldPriceKopecks: null, stockQty: 0, availability: 'in_stock', published: true, hidden: false, slug: 's', purchasePriceKopecks: null }, false);
    expect(line).toContain("'=1+1");
    expect(line).toContain("'@x");
  });

  it('порциями: больше одной порции, все строки на месте и без повторов', async () => {
    const { db, tools } = shop();
    db.exec('BEGIN');
    for (let i = 0; i < 1100; i++) addProduct(db, { name: `Т${i}`, categoryId: tools });
    db.exec('COMMIT');
    const { chunks } = productListOps.exportCsv(exporter, {}, o(db));
    const parts = [...chunks];
    expect(parts.length).toBeGreaterThan(3); // заголовок + три порции
    const body = parts.join('').slice(1).trim().split('\r\n');
    expect(body).toHaveLength(1101);
    expect(new Set(body.map((l) => l.split(';')[0])).size).toBe(1101);
  });

  it('права: нужны products.read И export.run; выгрузка пишется в аудит; лимит строк', () => {
    const { db, tools } = shop();
    addProduct(db, { name: 'Пила', categoryId: tools });
    expect(() => productListOps.exportCsv(null, {}, o(db))).toThrow(UnauthorizedError);
    expect(() => productListOps.exportCsv(editor, {}, o(db))).toThrow(ForbiddenError);
    expect(() => productListOps.exportCsv(S('only-export', ['export.run']), {}, o(db))).toThrow(ForbiddenError);
    expect(audit.list({ action: 'product.export' }, { db })).toEqual([]);
    productListOps.exportCsv(exporter, { q: 'пила' }, o(db));
    const log = audit.list({ action: 'product.export' }, { db });
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toMatchObject({ total: 1, filter: { q: 'пила' }, cost: false });
  });
});
