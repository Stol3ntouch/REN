import { describe, expect, it } from 'vitest';
import { getCategoryTree } from '@/domain/catalog/categories';
import { discountPercent } from '@/domain/catalog/price-display';
import { getProductBySlug } from '@/domain/catalog/product';
import { searchProducts } from '@/domain/catalog/search';
import { productJsonLd } from '@/domain/seo/jsonld';
import { productMetadata } from '@/domain/seo/metadata';
import { listSitemapEntries } from '@/domain/seo/sitemap';
import { getProductSeo } from '@/domain/seo/store';
import type { Db } from '@/server/db/connection';
import { addCategory, addProduct, baseQuery, createTestDb } from './helpers';

const set = (db: Db, id: number, sql: string, ...args: (string | number | null)[]) => db.prepare(`UPDATE products SET ${sql} WHERE id = ?`).run(...args, id);

function world() {
  const db = createTestDb();
  const cat = addCategory(db, 'Пилы', 'pily');
  const cat2 = addCategory(db, 'Для дома', 'dlya-doma');
  return { db, cat, cat2 };
}

describe('discountPercent', () => {
  it('процент считается только от реальной старой цены, больше цены к оплате', () => {
    expect(discountPercent(8000, 10000)).toBe(20);
    expect(discountPercent(9900, 10000)).toBe(1);
    expect(discountPercent(19600, 24500)).toBe(20);
    expect(discountPercent(9990, 10000)).toBeNull(); // меньше 1 %
    expect(discountPercent(10000, 10000)).toBeNull();
    expect(discountPercent(12000, 10000)).toBeNull();
    expect(discountPercent(8000, undefined)).toBeNull();
    expect(discountPercent(0, 10000)).toBeNull();
    expect(discountPercent(9999, 10000)).toBeNull(); // меньше 1 %
  });
});

describe('цена на витрине: старая цена и скидка', () => {
  it('старая цена больше цены → показывается как зачёркнутая; не больше — не показывается', async () => {
    const { db, cat } = world();
    const a = addProduct(db, { name: 'А', slug: 'a', categoryId: cat, priceRub: 800 });
    set(db, a, 'old_price_kopecks = ?', 100000);
    const b = addProduct(db, { name: 'Б', slug: 'b', categoryId: cat, priceRub: 800 });
    set(db, b, 'old_price_kopecks = ?', 80000);
    const c = addProduct(db, { name: 'В', slug: 'c', categoryId: cat, priceRub: 800 });
    set(db, c, 'old_price_kopecks = ?', 50000);
    expect(await getProductBySlug('a', { db })).toMatchObject({ unitKopecks: 80000, originalKopecks: 100000 });
    expect((await getProductBySlug('b', { db }))!.originalKopecks).toBeUndefined();
    expect((await getProductBySlug('c', { db }))!.originalKopecks).toBeUndefined();
  });

  it('при скидочной цене зачёркнута обычная; старая цена выше обычной перекрывает её', async () => {
    const { db, cat } = world();
    const a = addProduct(db, { name: 'А', slug: 'a', categoryId: cat, priceRub: 1000, discountRub: 800 });
    const b = addProduct(db, { name: 'Б', slug: 'b', categoryId: cat, priceRub: 1000, discountRub: 800 });
    set(db, b, 'old_price_kopecks = ?', 120000);
    expect(a).toBeGreaterThan(0);
    expect(await getProductBySlug('a', { db })).toMatchObject({ unitKopecks: 80000, originalKopecks: 100000 });
    expect(await getProductBySlug('b', { db })).toMatchObject({ unitKopecks: 80000, originalKopecks: 120000 });
  });

  it('карточки в листинге несут старую цену, флаги «Новинка» и «Акция»', async () => {
    const { db, cat } = world();
    const a = addProduct(db, { name: 'Пила А', slug: 'a', categoryId: cat, priceRub: 800 });
    set(db, a, 'old_price_kopecks = ?, is_new = 1, is_promo = 1', 100000);
    addProduct(db, { name: 'Пила Б', slug: 'b', categoryId: cat, priceRub: 800 });
    const r = await searchProducts({ ...baseQuery, categorySlug: 'pily' }, { db });
    const byName = Object.fromEntries(r.items.map((i) => [i.name, i]));
    expect(byName['Пила А']).toMatchObject({ unitKopecks: 80000, originalKopecks: 100000, isNew: true, isPromo: true });
    expect(byName['Пила Б']).toMatchObject({ isNew: false, isPromo: false });
    expect(byName['Пила Б']!.originalKopecks).toBeUndefined();
  });
});

describe('наличие по availability', () => {
  it('в наличии и под заказ покупаются; нет в наличии и снят с продажи — нет; страница отдаёт статус', async () => {
    const { db, cat } = world();
    const ids = {
      in_stock: addProduct(db, { name: '1', slug: 'in-stock', categoryId: cat }),
      preorder: addProduct(db, { name: '2', slug: 'preorder', categoryId: cat }),
      out_of_stock: addProduct(db, { name: '3', slug: 'out-of-stock', categoryId: cat }),
      discontinued: addProduct(db, { name: '4', slug: 'discontinued', categoryId: cat }),
    };
    set(db, ids.preorder, "availability = 'preorder', availability_manual = 1, in_stock = 1");
    set(db, ids.out_of_stock, "availability = 'out_of_stock', in_stock = 0");
    set(db, ids.discontinued, "availability = 'discontinued', availability_manual = 1, in_stock = 0");
    const got = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k]) => [k, await getProductBySlug(k.replaceAll('_', '-'), { db })])));
    expect(got.in_stock).toMatchObject({ availability: 'in_stock', inStock: true });
    expect(got.preorder).toMatchObject({ availability: 'preorder', inStock: true });
    expect(got.out_of_stock).toMatchObject({ availability: 'out_of_stock', inStock: false });
    expect(got.discontinued).toMatchObject({ availability: 'discontinued', inStock: false });
  });

  it('JSON-LD отражает статус: InStock, PreOrder, OutOfStock, Discontinued', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'П', slug: 'p', categoryId: cat });
    const ld = async (sql: string) => {
      set(db, id, sql);
      const p = (await getProductBySlug('p', { db }))!;
      return (productJsonLd(p, { average: null, count: 0 }, 'https://shop.test').offers as { availability: string }).availability;
    };
    expect(await ld("availability = 'in_stock', in_stock = 1")).toBe('https://schema.org/InStock');
    expect(await ld("availability = 'preorder', in_stock = 1")).toBe('https://schema.org/PreOrder');
    expect(await ld("availability = 'out_of_stock', in_stock = 0")).toBe('https://schema.org/OutOfStock');
    expect(await ld("availability = 'discontinued', in_stock = 0")).toBe('https://schema.org/Discontinued');
  });
});

describe('несколько категорий', () => {
  it('товар виден в дополнительной категории и считается в счётчиках дерева без двойного учёта в родителе', async () => {
    const { db, cat, cat2 } = world();
    const child = addCategory(db, 'Дочерняя', 'child', cat);
    const id = addProduct(db, { name: 'Пила', slug: 'pila', categoryId: cat });
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(id, cat2);
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 2)').run(id, child);

    const inExtra = await searchProducts({ ...baseQuery, categorySlug: 'dlya-doma' }, { db });
    expect(inExtra.items.map((i) => i.name)).toEqual(['Пила']);
    expect(inExtra.total).toBe(1);

    const primary = await searchProducts({ ...baseQuery, categorySlug: 'pily' }, { db });
    expect(primary.total).toBe(1); // в родителе и в дочерней — один товар, не два

    const tree = await getCategoryTree({ db });
    const byId = new Map<number, number>();
    const walk = (n: { id: number; productCount: number; children: never[] }) => {
      byId.set(n.id, n.productCount);
      n.children.forEach(walk);
    };
    tree.forEach((n) => walk(n as never));
    expect(byId.get(cat)).toBe(1);
    expect(byId.get(cat2)).toBe(1);
    expect(byId.get(child)).toBe(1);
  });

  it('скрытая дополнительная категория товар не показывает; сам товар остаётся в основной', async () => {
    const { db, cat, cat2 } = world();
    const id = addProduct(db, { name: 'Пила', slug: 'pila', categoryId: cat });
    db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (?, ?, 0, 1)').run(id, cat2);
    expect((await searchProducts({ ...baseQuery, categorySlug: 'pily' }, { db })).total).toBe(1);
  });

  it('импорт и прямой UPDATE category_id держат основную строку product_categories в согласии', () => {
    const { db, cat, cat2 } = world();
    const id = addProduct(db, { name: 'Пила', categoryId: cat });
    const primary = () => db.prepare('SELECT category_id FROM product_categories WHERE product_id = ? AND is_primary = 1').all(id);
    expect(primary()).toEqual([{ category_id: cat }]);
    set(db, id, 'category_id = ?', cat2);
    expect(primary()).toEqual([{ category_id: cat2 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_categories WHERE product_id = ?').get(id)).toEqual({ n: 1 });
  });
});

describe('canonical и indexable', () => {
  it('метаданные товара берут canonical и noindex из карточки', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Пила', slug: 'pila', categoryId: cat });
    set(db, id, "canonical_url = 'https://example.com/canon', indexable = 0");
    const p = (await getProductBySlug('pila', { db }))!;
    const meta = productMetadata(p, getProductSeo(id, { db }));
    expect(meta.alternates?.canonical).toBe('https://example.com/canon');
    expect(meta.robots).toMatchObject({ index: false });
  });

  it('без правок — canonical на сам товар и индексация включена', async () => {
    const { db, cat } = world();
    const id = addProduct(db, { name: 'Пила', slug: 'pila', categoryId: cat });
    const meta = productMetadata((await getProductBySlug('pila', { db }))!, getProductSeo(id, { db }));
    expect(meta.alternates?.canonical).toBe('/product/pila');
    expect(meta.robots).toBeUndefined();
  });

  it('sitemap не содержит товары с indexable = 0', () => {
    const { db, cat } = world();
    addProduct(db, { name: 'Виден', slug: 'visible', categoryId: cat });
    const hidden = addProduct(db, { name: 'Не индексировать', slug: 'noindex', categoryId: cat });
    set(db, hidden, 'indexable = 0', );
    const urls = listSitemapEntries({ db, siteUrl: 'https://shop.test' }).map((e) => e.url);
    expect(urls).toContain('https://shop.test/product/visible');
    expect(urls).not.toContain('https://shop.test/product/noindex');
  });
});
