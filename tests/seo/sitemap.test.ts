import { describe, expect, it } from 'vitest';
import { listSitemapEntries, SITEMAP_LIMIT, splitSitemap } from '@/domain/seo/sitemap';
import { setSetting } from '@/domain/content/settings';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const SITE = 'https://shop.example.ru';

describe('sitemap', () => {
  it('содержит категории с товарами, опубликованные товары и страницы контента — и ничего служебного', () => {
    const db = createTestDb();
    const root = addCategory(db, 'Садовая техника', 'sadovaya');
    const full = addCategory(db, 'Триммеры', 'trimmery', root);
    addCategory(db, 'Пустая', 'pustaya', root);
    addProduct(db, { name: 'Триммер', slug: 'trimmer-1', categoryId: full });
    addProduct(db, { name: 'Скрытый', slug: 'skrytyj', categoryId: full, published: false });
    setSetting('phone', '+7 900 000-00-00', { db });

    const urls = listSitemapEntries({ db, siteUrl: SITE }).map((e) => e.url);

    expect(urls).toContain(`${SITE}/`);
    expect(urls).toContain(`${SITE}/contacts`);
    expect(urls).toContain(`${SITE}/catalog`);
    expect(urls).toContain(`${SITE}/catalog/sadovaya`); // родитель: товары лежат во вложенной категории
    expect(urls).toContain(`${SITE}/catalog/trimmery`);
    expect(urls).toContain(`${SITE}/product/trimmer-1`);
    expect(urls).not.toContain(`${SITE}/catalog/pustaya`);
    expect(urls).not.toContain(`${SITE}/product/skrytyj`);
    for (const forbidden of ['/cart', '/checkout', '/account', '/admin', '/search', '/favorites', '/compare', '/order', '/pay', '/api']) {
      expect(urls.some((u) => u === `${SITE}${forbidden}` || u.startsWith(`${SITE}${forbidden}/`))).toBe(false);
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('у товара lastModified берётся из updated_at', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    addProduct(db, { name: 'Триммер', slug: 'trimmer-1', categoryId: cat });
    const entry = listSitemapEntries({ db, siteUrl: SITE }).find((e) => e.url.endsWith('/product/trimmer-1'));
    expect(entry?.lastModified?.toISOString()).toBe('2026-10-22T10:00:00.000Z');
  });

  it('разбивает на файлы не больше лимита', () => {
    const entries = Array.from({ length: 2 * SITEMAP_LIMIT + 5 }, (_, i) => ({ url: `${SITE}/p/${i}` }));
    const parts = splitSitemap(entries);
    expect(parts.map((p) => p.length)).toEqual([SITEMAP_LIMIT, SITEMAP_LIMIT, 5]);
    expect(SITEMAP_LIMIT).toBe(50000);
  });
});
