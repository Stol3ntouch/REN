import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { categoryVisibilityOps } from '@/app/admin/(panel)/catalog/category-visibility-ops';
import { CategoryVisibilityTable } from '@/app/admin/(panel)/catalog/categories/CategoryVisibilityTable';
import { clearCategoryImageCache, getCategoryImages } from '@/domain/catalog/category-images';
import {
  getCategoryBreadcrumbs,
  getCategoryBySlug,
  getCategoryTree,
  getFacets,
  getProductBySlug,
  getRelatedProducts,
  getSiblingCategories,
  searchProducts,
} from '@/domain/catalog';
import { getHomeData } from '@/domain/content/home';
import { loadShellContext } from '@/domain/content/shell';
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
import { addCategory, addProduct, baseQuery } from '../catalog/helpers';
import { GUEST_A, deliveryId, paymentId } from '../ordering/helpers';
import { admin, importXml, manager, productByExternal, T0 } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const flags = (db: Db, id: number) => db.prepare('SELECT hidden_by_admin AS own, effective_hidden AS eff FROM categories WHERE id = ?').get(id) as { own: number; eff: number };
const SITE = 'https://shop.example.ru';

/** Садовая техника → Триммеры → Бензиновые; рядом корневые «Насосы» и «Пилы». */
function shop() {
  const db = createTestDb();
  const sad = addCategory(db, 'Садовая техника', 'sad');
  const trim = addCategory(db, 'Триммеры', 'trimmery', sad);
  const benzo = addCategory(db, 'Бензиновые триммеры', 'benzo', trim);
  const pumps = addCategory(db, 'Насосы', 'nasosy');
  const saws = addCategory(db, 'Пилы', 'pily');
  const attrs = { Мощность: '1000 Вт' };
  const trimmers = [1, 2, 3].map((i) =>
    addProduct(db, { name: `Триммер ${i}`, slug: `trimmer-${i}`, categoryId: trim, attrs, images: [`https://champion.ru/t${i}.jpg`] }),
  );
  const benzoProduct = addProduct(db, { name: 'Бензотриммер', slug: 'benzotrimmer', categoryId: benzo, images: ['https://champion.ru/b.jpg'] });
  const direct = addProduct(db, { name: 'Секатор', slug: 'sekator', categoryId: sad, images: ['https://champion.ru/s.jpg'] });
  const pump = addProduct(db, { name: 'Насос', slug: 'nasos', categoryId: pumps, images: ['https://champion.ru/n.jpg'] });
  const saw = addProduct(db, { name: 'Пила', slug: 'pila', categoryId: saws, images: ['https://champion.ru/p.jpg'] });
  return { db, sad, trim, benzo, pumps, saws, trimmers, benzoProduct, direct, pump, saw };
}

describe('скрытие категорий: права, проверка входа, аудит', () => {
  it('менеджер — 403, без сессии — 401; ничего не меняется и не пишется в аудит', () => {
    const { db, trim } = shop();
    expect(() => categoryVisibilityOps.setHidden(manager, trim, true, opts(db))).toThrow(ForbiddenError);
    expect(() => categoryVisibilityOps.setHidden(null, trim, true, opts(db))).toThrow(UnauthorizedError);
    expect(flags(db, trim)).toEqual({ own: 0, eff: 0 });
    expect(audit.list({ entity: 'category' }, { db })).toEqual([]);
  });

  it('менеджер читает список (catalog.read); без сессии — 401', () => {
    const { db } = shop();
    expect(categoryVisibilityOps.list(manager, { db }).length).toBe(5);
    expect(() => categoryVisibilityOps.list(null, { db })).toThrow(UnauthorizedError);
  });

  it('проверка входа: неизвестная и неверная категория, неверный признак', () => {
    const { db } = shop();
    expect(() => categoryVisibilityOps.setHidden(admin, 99999, true, opts(db))).toThrow(NotFoundError);
    expect(() => categoryVisibilityOps.setHidden(admin, 0, true, opts(db))).toThrow(ValidationError);
    expect(() => categoryVisibilityOps.setHidden(admin, 'x' as unknown as number, true, opts(db))).toThrow(ValidationError);
    expect(() => categoryVisibilityOps.setHidden(admin, 1, 'yes' as unknown as boolean, opts(db))).toThrow(ValidationError);
  });

  it('скрытие родителя скрывает потомков (свой признак у них остаётся 0); «показать» возвращает; аудит category.visibility', () => {
    const { db, sad, trim, benzo, pumps } = shop();
    expect(categoryVisibilityOps.setHidden(admin, trim, true, opts(db))).toEqual({ changed: true });
    expect(flags(db, trim)).toEqual({ own: 1, eff: 1 });
    expect(flags(db, benzo)).toEqual({ own: 0, eff: 1 });
    expect(flags(db, sad)).toEqual({ own: 0, eff: 0 });
    expect(flags(db, pumps)).toEqual({ own: 0, eff: 0 });

    const rows = audit.list({ action: 'category.visibility' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'category', entityId: String(trim), actorId: '1', actorType: 'staff', before: { hidden: false }, after: { hidden: true } });

    // повтор того же — без изменений и без новой записи в аудите
    expect(categoryVisibilityOps.setHidden(admin, trim, true, opts(db))).toEqual({ changed: false });
    expect(audit.list({ action: 'category.visibility' }, { db })).toHaveLength(1);

    expect(categoryVisibilityOps.setHidden(admin, trim, false, opts(db))).toEqual({ changed: true });
    expect(flags(db, trim)).toEqual({ own: 0, eff: 0 });
    expect(flags(db, benzo)).toEqual({ own: 0, eff: 0 });
    expect(audit.list({ action: 'category.visibility' }, { db })).toHaveLength(2);
  });

  it('потомок, скрытый сам, остаётся скрытым после показа родителя', () => {
    const { db, trim, benzo } = shop();
    categoryVisibilityOps.setHidden(admin, benzo, true, opts(db));
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    categoryVisibilityOps.setHidden(admin, trim, false, opts(db));
    expect(flags(db, trim)).toEqual({ own: 0, eff: 0 });
    expect(flags(db, benzo)).toEqual({ own: 1, eff: 1 });
  });

  it('список для админки: глубина, признаки и число товаров поддерева; «скрыта родителем» отличается от «скрыта»', () => {
    const { db, sad, trim, benzo } = shop();
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    const rows = categoryVisibilityOps.list(admin, { db });
    const by = (id: number) => rows.find((r) => r.id === id)!;
    expect(by(sad)).toMatchObject({ depth: 0, hidden: false, effectiveHidden: false, productCount: 5 });
    expect(by(trim)).toMatchObject({ depth: 1, hidden: true, effectiveHidden: true, productCount: 4 });
    expect(by(benzo)).toMatchObject({ depth: 2, hidden: false, effectiveHidden: true, productCount: 1 });
  });

  it('последствия: сколько категорий и товаров затронет действие (без уже скрытых)', () => {
    const { db, trim, benzo } = shop();
    db.prepare("UPDATE products SET published = 0 WHERE slug = 'trimmer-3'").run(); // уже не виден — не считается
    expect(categoryVisibilityOps.impact(admin, trim, true, { db })).toEqual({ categories: 2, products: 3 });
    categoryVisibilityOps.setHidden(admin, benzo, true, opts(db));
    expect(categoryVisibilityOps.impact(admin, trim, true, { db })).toEqual({ categories: 1, products: 2 });
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    // показываем родителя: вернётся сама «Триммеры»; «Бензиновые» скрыта сама
    expect(categoryVisibilityOps.impact(admin, trim, false, { db })).toEqual({ categories: 1, products: 2 });
    expect(() => categoryVisibilityOps.impact(manager, trim, true, { db })).toThrow(ForbiddenError);
  });
});

describe('товары скрытой категории исчезают с сайта', () => {
  it('листинги, поиск и родительская категория: скрытые подкатегории не попадают; прямые товары родителя остаются', async () => {
    const { db, trimmers } = shop();
    const before = await searchProducts({ ...baseQuery, categorySlug: 'sad', pageSize: 50 }, { db });
    expect(before.total).toBe(5);
    categoryVisibilityOps.setHidden(admin, db.prepare("SELECT id FROM categories WHERE slug = 'trimmery'").get()!.id as number, true, opts(db));

    const hiddenList = await searchProducts({ ...baseQuery, categorySlug: 'trimmery', pageSize: 50 }, { db });
    expect(hiddenList.total).toBe(0);
    expect((await searchProducts({ ...baseQuery, categorySlug: 'benzo', pageSize: 50 }, { db })).total).toBe(0);
    const parent = await searchProducts({ ...baseQuery, categorySlug: 'sad', pageSize: 50 }, { db });
    expect(parent.items.map((p) => p.name)).toEqual(['Секатор']);
    const found = await searchProducts({ ...baseQuery, text: 'Триммер', pageSize: 50 }, { db });
    expect(found.total).toBe(0);
    expect(trimmers).toHaveLength(3);
    expect((await searchProducts({ ...baseQuery, text: 'Насос', pageSize: 50 }, { db })).total).toBe(1);
  });

  it('страница товара — null (404), фильтры пусты, сопутствующие не показывают скрытое', async () => {
    const { db, trim, trimmers, sad } = shop();
    expect(await getProductBySlug('trimmer-1', { db })).not.toBeNull();
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    expect(await getProductBySlug('trimmer-1', { db })).toBeNull();
    expect(await getProductBySlug('benzotrimmer', { db })).toBeNull();
    expect(await getProductBySlug('sekator', { db })).not.toBeNull();
    expect(await getFacets(trim, { filters: {} }, { db })).toEqual([]);
    expect(await getRelatedProducts(trimmers[0]!, { db })).toEqual([]);
    expect(sad).toBeGreaterThan(0);
  });

  it('главная: блоки товаров, плитки категорий и их счётчики не включают скрытое', async () => {
    const { db, sad, trim, trimmers, pumps } = shop();
    db.prepare('UPDATE products SET featured = 1 WHERE id = ?').run(trimmers[0]!);
    db.prepare('UPDATE products SET discount_price_kopecks = 50000 WHERE id = ?').run(trimmers[1]!);
    const now = new Date('2026-10-23T10:00:00.000Z');
    const idsOf = (h: Awaited<ReturnType<typeof getHomeData>>) => [h.newProducts, h.popularProducts, h.promoProducts, h.catalogProducts].flatMap((l) => l.map((p) => p.id));
    expect(idsOf(await getHomeData({ db, now }))).toEqual(expect.arrayContaining([trimmers[0]!, trimmers[1]!]));

    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    const home = await getHomeData({ db, now });
    for (const id of trimmers) expect(idsOf(home)).not.toContain(id);
    expect(home.categories.find((c) => c.id === sad)?.productCount).toBe(1);
    expect(home.categories.map((c) => c.id)).toEqual(expect.arrayContaining([sad, pumps]));

    categoryVisibilityOps.setHidden(admin, pumps, true, opts(db));
    expect((await getHomeData({ db, now })).categories.map((c) => c.id)).not.toContain(pumps);
  });

  it('плитки: фото родителя не берётся из скрытой подкатегории', () => {
    const { db, sad, trim } = shop();
    db.prepare("UPDATE products SET in_stock = 0 WHERE slug = 'sekator'").run(); // в наличии приоритетнее — без скрытия выиграл бы триммер
    clearCategoryImageCache();
    expect(getCategoryImages([sad], { db, now: T0 }).get(sad)?.src).toBe('https://champion.ru/t1.jpg');
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db)); // сам сбрасывает кэш картинок
    expect(getCategoryImages([sad, trim], { db, now: T0 }).get(sad)?.src).toBe('https://champion.ru/s.jpg');
    expect(getCategoryImages([trim], { db, now: T0 }).get(trim)).toBeNull();
  });

  it('sitemap: ни скрытых категорий и подкатегорий, ни их товаров', () => {
    const { db, trim } = shop();
    const urls = () => listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url);
    expect(urls()).toEqual(expect.arrayContaining([`${SITE}/catalog/trimmery`, `${SITE}/catalog/benzo`, `${SITE}/product/trimmer-1`]));
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    const after = urls();
    for (const gone of ['/catalog/trimmery', '/catalog/benzo', '/product/trimmer-1', '/product/benzotrimmer']) expect(after).not.toContain(`${SITE}${gone}`);
    expect(after).toEqual(expect.arrayContaining([`${SITE}/catalog/sad`, `${SITE}/product/sekator`, `${SITE}/catalog/nasosy`]));
  });

  it('избранное и сравнение: товар скрытой категории не показывается, не считается и не добавляется; после «показать» возвращается', () => {
    const { db, trim, trimmers } = shop();
    const [a, b] = trimmers as [number, number, number];
    favorites.add(GUEST_A, a, opts(db));
    compare.add(GUEST_A, a, opts(db));
    favorites.add(GUEST_A, b, opts(db));
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    expect(favorites.list(GUEST_A, { db })).toEqual([]);
    expect(favoritesCount(GUEST_A, { db })).toBe(0);
    expect(compare.list(GUEST_A, { db })).toEqual([]);
    expect(() => favorites.add(GUEST_A, a, opts(db))).toThrow(NotFoundError);
    expect(() => compare.add(GUEST_A, a, opts(db))).toThrow(NotFoundError);
    categoryVisibilityOps.setHidden(admin, trim, false, opts(db));
    expect([...favorites.list(GUEST_A, { db })].sort()).toEqual([a, b].sort());
  });
});

describe('скрытая категория в дереве, крошках, меню и подвале', () => {
  it('дерево, соседи, крошки, поиск по slug и счётчики родителей', async () => {
    const { db, sad, trim, pumps } = shop();
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    const tree = await getCategoryTree({ db });
    const root = tree.find((c) => c.id === sad)!;
    expect(root.children).toEqual([]);
    expect(root.productCount).toBe(1);
    expect(tree.map((c) => c.id)).toContain(pumps);
    expect(await getCategoryBySlug('trimmery', { db })).toBeNull();
    expect(await getCategoryBySlug('benzo', { db })).toBeNull(); // потомок скрытого тоже
    expect(await getCategoryBySlug('sad', { db })).not.toBeNull();
    expect(await getCategoryBreadcrumbs('benzo', { db })).toEqual([]);
    expect((await getSiblingCategories('nasosy', { db })).map((c) => c.slug)).toEqual(['sad', 'pily']);
    categoryVisibilityOps.setHidden(admin, pumps, true, opts(db));
    expect((await getSiblingCategories('pily', { db })).map((c) => c.slug)).toEqual(['sad']);
  });

  it('меню «Каталог» в подвале: скрытый корень пропадает, после «показать» возвращается', () => {
    const { db, pumps } = shop();
    const links = () => (loadShellContext({ db, now: T0 }).catalogLinks ?? []).map((l) => l.href);
    expect(links()).toContain('/catalog/nasosy');
    categoryVisibilityOps.setHidden(admin, pumps, true, opts(db));
    expect(links()).not.toContain('/catalog/nasosy');
    categoryVisibilityOps.setHidden(admin, pumps, false, opts(db));
    expect(links()).toContain('/catalog/nasosy');
  });
});

describe('корзина, заказы, импорт', () => {
  const place = (db: Db) =>
    checkout.place(
      {
        owner: GUEST_A,
        cartId: cart.get(GUEST_A, { db }).cartId,
        contact: { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33' },
        deliveryMethodId: deliveryId(db, 'pickup'),
        paymentMethodId: paymentId(db, 'cod'),
        idempotencyKey: 'key-hide-category-12345',
        consent: true,
      },
      { db, now: T0, secret: 'x'.repeat(40) },
    );

  it('товар скрытой категории в корзине — «снят с продажи»; заказ невозможен; показать — снова можно', async () => {
    const { db, trim, trimmers, pump } = shop();
    cart.add(GUEST_A, { productId: trimmers[0]!, qty: 1 }, opts(db));
    cart.add(GUEST_A, { productId: pump, qty: 1 }, opts(db));
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    const view = cart.get(GUEST_A, opts(db));
    expect(view.items.find((i) => i.productId === trimmers[0])).toMatchObject({ available: false });
    expect(view.items.find((i) => i.productId === pump)).toMatchObject({ available: true });
    const res = await checkout.validate(view.cartId, GUEST_A, { db, now: T0 });
    expect(res).toMatchObject({ ok: false, changes: [{ kind: 'unavailable', productId: trimmers[0], reason: 'unpublished' }] });
    expect(() => cart.add(GUEST_A, { productId: trimmers[1]!, qty: 1 }, opts(db))).toThrow(NotFoundError);
    categoryVisibilityOps.setHidden(admin, trim, false, opts(db));
    expect((await checkout.validate(cart.get(GUEST_A, opts(db)).cartId, GUEST_A, { db, now: T0 })).ok).toBe(true);
  });

  it('прошлые заказы не меняются при скрытии категории', async () => {
    const { db, trim, trimmers } = shop();
    cart.add(GUEST_A, { productId: trimmers[0]!, qty: 2 }, opts(db));
    const order = await place(db);
    const snapshot = JSON.stringify(orders.getForCustomer(order.number, GUEST_A, { db }));
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    expect(JSON.stringify(orders.getForCustomer(order.number, GUEST_A, { db }))).toBe(snapshot);
  });

  it('повторный импорт не возвращает скрытую категорию; новая подкатегория под скрытой наследует скрытость', async () => {
    const db = createTestDb();
    const base = [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">Бензиновые генераторы</category>`];
    await importXml(db, ymlXml({ categories: base, offers: [{ id: '1', categoryId: '10' }, { id: '2', categoryId: '11' }] }));
    const cat = (ext: string) => db.prepare("SELECT id FROM categories WHERE external_id = ?").get(ext) as { id: number };
    categoryVisibilityOps.setHidden(admin, cat('10').id, true, opts(db));

    const more = [...base, `<category id="12" parentId="10">Дизельные генераторы</category>`, `<category id="13">Насосы</category>`];
    await importXml(db, ymlXml({ categories: more, offers: [{ id: '1', categoryId: '10' }, { id: '2', categoryId: '11' }, { id: '3', categoryId: '12' }, { id: '4', categoryId: '13' }] }));

    expect(flags(db, cat('10').id)).toEqual({ own: 1, eff: 1 });
    expect(flags(db, cat('11').id)).toEqual({ own: 0, eff: 1 });
    expect(flags(db, cat('12').id)).toEqual({ own: 0, eff: 1 }); // новая под скрытой
    expect(flags(db, cat('13').id)).toEqual({ own: 0, eff: 0 });
    for (const id of ['1', '2', '3']) expect(await getProductBySlug(productByExternal(db, id).slug, { db })).toBeNull();
    expect(await getProductBySlug(productByExternal(db, '4').slug, { db })).not.toBeNull();

    categoryVisibilityOps.setHidden(admin, cat('10').id, false, opts(db));
    for (const id of ['1', '2', '3']) expect(await getProductBySlug(productByExternal(db, id).slug, { db })).not.toBeNull();
  });

  it('импорт, который переносит категорию под скрытого родителя, скрывает её', async () => {
    const db = createTestDb();
    await importXml(db, ymlXml({ categories: [`<category id="10">А</category>`, `<category id="20">Б</category>`], offers: [{ id: '1', categoryId: '20' }] }));
    const id = (ext: string) => (db.prepare('SELECT id FROM categories WHERE external_id = ?').get(ext) as { id: number }).id;
    categoryVisibilityOps.setHidden(admin, id('10'), true, opts(db));
    await importXml(db, ymlXml({ categories: [`<category id="10">А</category>`, `<category id="20" parentId="10">Б</category>`], offers: [{ id: '1', categoryId: '20' }] }));
    expect(flags(db, id('20'))).toEqual({ own: 0, eff: 1 });
    expect(await getProductBySlug(productByExternal(db, '1').slug, { db })).toBeNull();
  });
});

describe('админка: таблица категорий', () => {
  function rowsFor() {
    const { db, trim } = shop();
    categoryVisibilityOps.setHidden(admin, trim, true, opts(db));
    return categoryVisibilityOps.list(admin, { db });
  }

  it('менеджер видит пометки, но не кнопки; админ — кнопки «Скрыть»/«Показать»', () => {
    const rows = rowsFor();
    const asManager = renderToStaticMarkup(<CategoryVisibilityTable rows={rows} canWrite={false} />);
    const asAdmin = renderToStaticMarkup(<CategoryVisibilityTable rows={rows} canWrite />);
    expect(asManager).toContain('скрыта');
    expect(asManager).toContain('скрыта вместе с родителем');
    expect(asManager).not.toContain('Скрыть');
    expect(asManager).not.toContain('Показать');
    expect(asAdmin).toContain('Скрыть');
    expect(asAdmin).toContain('Показать');
  });

  it('подтверждение называет число категорий и товаров и отправляет форму действия', () => {
    const html = renderToStaticMarkup(
      <CategoryVisibilityTable rows={rowsFor()} canWrite confirm={{ id: 2, name: 'Триммеры', hide: true, categories: 2, products: 3 }} />,
    );
    expect(html).toContain('Скрыть категорию «Триммеры»');
    expect(html).toMatch(/3\s+товар/);
    expect(html).toMatch(/2\s+категор/);
    expect(html).toContain('Подтвердить');
  });
});
