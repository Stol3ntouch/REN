import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { catalogOps } from '@/app/admin/(panel)/_lib/catalog-ops';
import { ProductTable } from '@/app/admin/(panel)/catalog/ProductTable';
import { clearCategoryImageCache, getCategoryImages } from '@/domain/catalog/category-images';
import { getCategoryTree, getFacets, getProductBySlug, getRelatedProducts, searchProducts } from '@/domain/catalog';
import { getHomeData } from '@/domain/content/home';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { orders } from '@/domain/ordering/orders';
import { compare } from '@/domain/customers/compare';
import { favorites, favoritesCount } from '@/domain/customers/favorites';
import { listSitemapEntries } from '@/domain/seo/sitemap';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ymlXml } from '../importing/helpers';
import { addCategory, addProduct, attributeId, baseQuery } from '../catalog/helpers';
import { GUEST_A, deliveryId, paymentId } from '../ordering/helpers';
import { admin, importXml, manager, productByExternal, T0 } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const hidden = (db: Db, id: number): number => (db.prepare('SELECT hidden_by_admin AS h FROM products WHERE id = ?').get(id) as { h: number }).h;
/** Скрыть напрямую в БД — чтобы тесты витрины не зависели от админской операции. */
const hideRaw = (db: Db, ...ids: number[]) => {
  for (const id of ids) db.prepare('UPDATE products SET hidden_by_admin = 1 WHERE id = ?').run(id);
};

describe('скрытие товаров: права, проверка входа, аудит', () => {
  it('менеджер не может скрыть (403), без сессии — 401; данные не меняются', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const id = addProduct(db, { name: 'Триммер', categoryId: cat });
    expect(() => catalogOps.setHidden(manager, [id], true, opts(db))).toThrow(ForbiddenError);
    expect(() => catalogOps.setHidden(null, [id], true, opts(db))).toThrow(UnauthorizedError);
    expect(hidden(db, id)).toBe(0);
    expect(audit.list({ entity: 'product' }, { db })).toEqual([]);
  });

  it('админ скрывает и возвращает при ВЫКЛЮЧЕННОМ catalog.manualEdit; сайт и закрепления не затрагиваются', () => {
    const db = createTestDb();
    expect(catalogOps.isManualEditEnabled(db)).toBe(false);
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const id = addProduct(db, { name: 'Триммер', categoryId: cat });
    expect(catalogOps.setHidden(admin, [id], true, opts(db))).toEqual({ changed: [id] });
    expect(hidden(db, id)).toBe(1);
    expect(db.prepare('SELECT published, locked_fields FROM products WHERE id = ?').get(id)).toMatchObject({ published: 1, locked_fields: '[]' });
    expect(catalogOps.setHidden(admin, [id], false, opts(db))).toEqual({ changed: [id] });
    expect(hidden(db, id)).toBe(0);
  });

  it('аудит product.visibility на каждый изменённый товар: id и признак, без лишнего; повтор того же — без записей', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const a = addProduct(db, { name: 'А', categoryId: cat });
    const b = addProduct(db, { name: 'Б', categoryId: cat });
    catalogOps.setHidden(admin, [a, b], true, opts(db));
    const rows = audit.list({ action: 'product.visibility' }, { db });
    expect(rows.map((r) => r.entityId).sort()).toEqual([String(a), String(b)].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ entity: 'product', actorId: '1', actorType: 'staff', before: { hidden: false }, after: { hidden: true } });
    }
    expect(catalogOps.setHidden(admin, [a, b], true, opts(db))).toEqual({ changed: [] });
    expect(audit.list({ action: 'product.visibility' }, { db })).toHaveLength(2);
  });

  it('проверка входа (zod): пусто, не числа, дубли, больше 200, чужой id — отказ без изменений', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const id = addProduct(db, { name: 'А', categoryId: cat });
    expect(() => catalogOps.setHidden(admin, [], true, opts(db))).toThrow(ValidationError);
    expect(() => catalogOps.setHidden(admin, ['x'], true, opts(db))).toThrow(ValidationError);
    expect(() => catalogOps.setHidden(admin, [0, -1], true, opts(db))).toThrow(ValidationError);
    expect(() => catalogOps.setHidden(admin, Array.from({ length: 201 }, (_, i) => i + 1), true, opts(db))).toThrow(ValidationError);
    expect(() => catalogOps.setHidden(admin, [id, 99999], true, opts(db))).toThrow(NotFoundError);
    expect(hidden(db, id)).toBe(0);
    // ровно 200 допустимо (повтор id схлопывается, лишнего аудита нет)
    expect(catalogOps.setHidden(admin, [id, id], true, opts(db))).toEqual({ changed: [id] });
  });
});

describe('скрытый товар исчезает с сайта', () => {
  function shop() {
    const db = createTestDb();
    const root = addCategory(db, 'Садовая техника', 'sad');
    const cat = addCategory(db, 'Триммеры', 'trimmery', root);
    const attrs = { Мощность: '1000 Вт' };
    const ids = [1, 2, 3, 4].map((i) =>
      addProduct(db, { name: `Триммер ${i}`, slug: `trimmer-${i}`, categoryId: cat, attrs, images: [`https://champion.ru/${i}.jpg`] }),
    );
    return { db, root, cat, ids, power: attributeId(db, 'Мощность') };
  }

  it('листинг категории, поиск по тексту, счётчики и дерево категорий', async () => {
    const { db, root, cat, ids } = shop();
    const [a, b] = ids as [number, number, number, number];
    hideRaw(db, a);
    const list = await searchProducts({ ...baseQuery, categorySlug: 'trimmery', pageSize: 20 }, { db });
    expect(list.total).toBe(3);
    expect(list.items.map((p) => p.id)).not.toContain(a);
    const found = await searchProducts({ ...baseQuery, text: 'Триммер', pageSize: 20 }, { db });
    expect(found.items.map((p) => p.id)).not.toContain(a);
    expect(found.total).toBe(3);
    const tree = await getCategoryTree({ db });
    expect(tree.find((c) => c.id === root)?.productCount).toBe(3);
    expect(tree.find((c) => c.id === root)?.children.find((c) => c.id === cat)?.productCount).toBe(3);
    expect(b).toBeGreaterThan(0);
  });

  it('фильтры и их счётчики: скрытые не считаются, характеристика пропадает при <3 видимых', async () => {
    const { db, cat, power } = shop();
    const before = await getFacets(cat, { filters: {} }, { db });
    expect(before.find((f) => String(f.id) === power)?.values).toEqual([{ value: '1000 Вт', count: 4 }]);
    db.prepare('UPDATE products SET hidden_by_admin = 1 WHERE id = (SELECT MIN(id) FROM products)').run();
    const after = await getFacets(cat, { filters: {} }, { db });
    expect(after.find((f) => String(f.id) === power)?.values).toEqual([{ value: '1000 Вт', count: 3 }]);
    db.prepare('UPDATE products SET hidden_by_admin = 1 WHERE id = (SELECT MAX(id) FROM products)').run();
    expect((await getFacets(cat, { filters: {} }, { db })).find((f) => String(f.id) === power)).toBeUndefined(); // правило «≥3 товара»
  });

  it('сопутствующие и страница товара: скрытый — null (404), в чужих «сопутствующих» не появляется', async () => {
    const { db, ids } = shop();
    const [a, b] = ids as [number, number, number, number];
    hideRaw(db, a);
    expect(await getProductBySlug('trimmer-1', { db })).toBeNull();
    expect(await getProductBySlug('trimmer-2', { db })).not.toBeNull();
    const related = await getRelatedProducts(b, { db });
    expect(related.map((p) => p.id)).not.toContain(a);
    expect(related).toHaveLength(2);
  });

  it('блоки главной (новинки, хиты, акции) и плитки/картинки категорий', async () => {
    const { db, root, cat, ids } = shop();
    const [a, b, c, d] = ids as [number, number, number, number];
    db.prepare("UPDATE products SET first_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(d);
    db.prepare('UPDATE products SET featured = 1 WHERE id = ?').run(a);
    db.prepare('UPDATE products SET discount_price_kopecks = 50000 WHERE id = ?').run(b);
    const now = new Date('2026-10-23T10:00:00.000Z');
    const home = await getHomeData({ db, now });
    const homeIds = () => [home.newProducts, home.popularProducts, home.promoProducts, home.catalogProducts].flatMap((l) => l.map((p) => p.id));
    expect(homeIds()).toEqual(expect.arrayContaining([a, b, c]));

    hideRaw(db, a, b, c);
    const after = await getHomeData({ db, now });
    const afterIds = [after.newProducts, after.popularProducts, after.promoProducts, after.catalogProducts].flatMap((l) => l.map((p) => p.id));
    for (const hid of [a, b, c]) expect(afterIds).not.toContain(hid);
    expect(after.categories.find((x) => x.id === root)?.productCount).toBe(1);

    // плитка категории берёт фото первого ВИДИМОГО товара
    clearCategoryImageCache();
    expect(getCategoryImages([cat], { db, now: T0 }).get(cat)?.src).toBe('https://champion.ru/4.jpg');
    hideRaw(db, d);
    clearCategoryImageCache();
    expect(getCategoryImages([cat, root], { db, now: T0 }).get(cat)).toBeNull();
  });

  it('sitemap: ни товара, ни категории, где все товары скрыты', () => {
    const { db, ids } = shop();
    const site = 'https://shop.example.ru';
    expect(listSitemapEntries({ db, siteUrl: site }).map((e) => e.url)).toContain(`${site}/product/trimmer-1`);
    hideRaw(db, ids[0]!);
    let urls = listSitemapEntries({ db, siteUrl: site }).map((e) => e.url);
    expect(urls).not.toContain(`${site}/product/trimmer-1`);
    expect(urls).toContain(`${site}/catalog/trimmery`);
    hideRaw(db, ...ids);
    urls = listSitemapEntries({ db, siteUrl: site }).map((e) => e.url);
    expect(urls).not.toContain(`${site}/catalog/trimmery`);
    expect(urls.some((u) => u.includes('/product/'))).toBe(false);
  });

  it('избранное и сравнение: скрытый не показывается, не считается и не добавляется', () => {
    const { db, ids } = shop();
    const [a, b] = ids as [number, number, number, number];
    favorites.add(GUEST_A, a, opts(db));
    favorites.add(GUEST_A, b, opts(db));
    compare.add(GUEST_A, a, opts(db));
    compare.add(GUEST_A, b, opts(db));
    hideRaw(db, a);
    expect(favorites.list(GUEST_A, { db })).toEqual([b]);
    expect(favorites.cards(GUEST_A, { db }).map((p) => p.id)).toEqual([b]);
    expect(favoritesCount(GUEST_A, { db })).toBe(1);
    expect(compare.list(GUEST_A, { db })).toEqual([b]);
    expect(compare.table(GUEST_A, { db }).products.map((p) => p.id)).toEqual([b]);
    expect(() => favorites.add(GUEST_A, a, opts(db))).toThrow(NotFoundError);
    expect(() => compare.add(GUEST_A, a, opts(db))).toThrow(NotFoundError);
    // запись о товаре не удалена: после «Показать» всё возвращается
    db.prepare('UPDATE products SET hidden_by_admin = 0 WHERE id = ?').run(a);
    expect([...favorites.list(GUEST_A, { db })].sort()).toEqual([a, b].sort());
  });
});

describe('корзина и заказы', () => {
  function filled() {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const a = addProduct(db, { name: 'Триммер А', categoryId: cat, priceRub: 5000 });
    const b = addProduct(db, { name: 'Триммер Б', categoryId: cat, priceRub: 3000 });
    cart.add(GUEST_A, { productId: a, qty: 1 }, opts(db));
    cart.add(GUEST_A, { productId: b, qty: 2 }, opts(db));
    return { db, a, b };
  }
  const place = (db: Db) =>
    checkout.place(
      {
        owner: GUEST_A,
        cartId: cart.get(GUEST_A, { db }).cartId,
        contact: { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: 'key-hide-products-12345',
        consent: true,
      },
      { db, now: T0, secret: 'x'.repeat(40) },
    );

  it('скрытый товар в корзине помечен «unpublished», validate возвращает изменение, заказ невозможен; показать — снова можно', async () => {
    const { db, a } = filled();
    catalogOps.setHidden(admin, [a], true, opts(db));
    const view = cart.get(GUEST_A, opts(db));
    expect(view.items.find((i) => i.productId === a)).toMatchObject({ available: false });
    const res = await checkout.validate(cart.get(GUEST_A, opts(db)).cartId, GUEST_A, { db, now: T0 });
    expect(res).toMatchObject({ ok: false, changes: [{ kind: 'unavailable', productId: a, reason: 'unpublished' }] });
    await expect(place(db)).rejects.toThrow();
    expect((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0);
    expect(() => cart.add(GUEST_A, { productId: a, qty: 1 }, opts(db))).toThrow(NotFoundError);

    catalogOps.setHidden(admin, [a], false, opts(db));
    expect((await checkout.validate(cart.get(GUEST_A, opts(db)).cartId, GUEST_A, { db, now: T0 })).ok).toBe(true);
  });

  it('прошлые заказы не меняются при скрытии товара', async () => {
    const { db, a, b } = filled();
    const order = await place(db);
    const snapshot = JSON.stringify(orders.getForCustomer(order.number, GUEST_A, { db }));
    catalogOps.setHidden(admin, [a, b], true, opts(db));
    expect(JSON.stringify(orders.getForCustomer(order.number, GUEST_A, { db }))).toBe(snapshot);
    expect(orders.getForCustomer(order.number, GUEST_A, { db })?.items).toHaveLength(2);
  });
});

describe('повторный импорт YML не возвращает скрытое в продажу', () => {
  it('скрыть → импорт с новой ценой → всё ещё скрыт, цена обновилась; показать → виден', async () => {
    const db = createTestDb();
    await importXml(db, ymlXml({ offers: [{ id: '1', name: 'Генератор', price: '1000.00' }, { id: '2', name: 'Насос', price: '500.00' }] }));
    const id = productByExternal(db, '1').id;
    catalogOps.setHidden(admin, [id], true, opts(db));

    await importXml(db, ymlXml({ offers: [{ id: '1', name: 'Генератор Про', price: '1500.00' }, { id: '2', name: 'Насос', price: '500.00' }] }));
    expect(hidden(db, id)).toBe(1);
    expect(productByExternal(db, '1')).toMatchObject({ name: 'Генератор Про', priceKopecks: 150_000 });
    expect(await getProductBySlug(productByExternal(db, '1').slug, { db })).toBeNull();
    expect((await searchProducts({ ...baseQuery, text: 'Генератор' }, { db })).total).toBe(0);

    catalogOps.setHidden(admin, [id], false, opts(db));
    expect(await getProductBySlug(productByExternal(db, '1').slug, { db })).not.toBeNull();
  });
});

describe('админка: список, пометка и счётчики', () => {
  function adminShop() {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    const ids = [1, 2, 3].map((i) => addProduct(db, { name: `Триммер ${i}`, categoryId: cat }));
    return { db, ids };
  }

  it('скрытые видны в админском списке с пометкой; фильтр «только скрытые»; числа учитывают скрытие', () => {
    const { db, ids } = adminShop();
    catalogOps.setHidden(admin, [ids[0]!], true, opts(db));
    const all = catalogOps.list(manager, {}, { db });
    expect(all.total).toBe(3);
    expect(all.rows.find((r) => r.id === ids[0])).toMatchObject({ hidden: true });
    expect(all.rows.find((r) => r.id === ids[1])).toMatchObject({ hidden: false });
    expect(all.counts).toEqual({ all: 3, hidden: 1 });
    const only = catalogOps.list(manager, { hiddenOnly: true }, { db });
    expect(only.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect(only.total).toBe(1);
  });

  it('таблица: у менеджера нет флажков и кнопок скрытия, у админа есть; скрытый помечен', () => {
    const { db, ids } = adminShop();
    catalogOps.setHidden(admin, [ids[0]!], true, opts(db));
    const { rows } = catalogOps.list(admin, {}, { db });
    const asManager = renderToStaticMarkup(<ProductTable rows={rows} canWrite={false} />);
    const asAdmin = renderToStaticMarkup(<ProductTable rows={rows} canWrite />);
    expect(asManager).toContain('скрыт');
    expect(asManager).not.toContain('Скрыть');
    expect(asManager).not.toContain('Показать');
    expect(asManager).not.toContain('type="checkbox"');
    expect(asAdmin).toContain('Скрыть выбранные');
    expect(asAdmin).toContain('Показать выбранные');
    expect(asAdmin).toContain('type="checkbox"');
    expect(asAdmin).toContain('скрыт');
  });
});
