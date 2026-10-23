import { describe, expect, it } from 'vitest';
import { getProductBySlug } from '@/domain/catalog/product';
import { getProductRating } from '@/domain/requests/public';
import { organizationJsonLd, productJsonLd } from '@/domain/seo/jsonld';
import { categoryMetadata, isFilteredCatalog, productMetadata } from '@/domain/seo/metadata';
import { getProductSeo } from '@/domain/seo/store';
import { reviewsRepo } from '@/server/db/repositories/reviews';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const SITE = 'https://shop.example.ru';

async function setup() {
  const db = createTestDb();
  const cat = addCategory(db, 'Триммеры', 'trimmery');
  const id = addProduct(db, {
    name: 'Триммер T523',
    slug: 'trimmer-t523',
    sku: 'T523',
    categoryId: cat,
    priceRub: 8990,
    description: '<p>Лёгкий <b>триммер</b></p>',
    images: ['https://champion.ru/a.jpg'],
  });
  return { db, cat, id };
}

describe('JSON-LD Product', () => {
  it('без опубликованных отзывов нет aggregateRating; цена и наличие есть', async () => {
    const { db, id } = await setup();
    reviewsRepo.insert(db, { productId: id, rating: 5, authorName: 'Иван', body: 'Ждёт модерации', now: 1 }); // pending
    const p = await getProductBySlug('trimmer-t523', { db });
    const ld = productJsonLd(p!, getProductRating(id, { db }), SITE);
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Триммер T523',
      sku: 'T523',
      image: ['https://champion.ru/a.jpg'],
      offers: { '@type': 'Offer', price: '8990.00', priceCurrency: 'RUB', availability: 'https://schema.org/InStock', url: `${SITE}/product/trimmer-t523` },
    });
  });

  it('с опубликованным отзывом рейтинг есть и считается только по опубликованным', async () => {
    const { db, id } = await setup();
    const r = reviewsRepo.insert(db, { productId: id, rating: 4, authorName: 'Иван', body: 'Хорошо', now: 1 });
    reviewsRepo.setStatus(db, r, 'published', null, 2);
    reviewsRepo.insert(db, { productId: id, rating: 1, authorName: 'Аноним', body: 'не опубликован', now: 3 });
    const p = await getProductBySlug('trimmer-t523', { db });
    const ld = productJsonLd(p!, getProductRating(id, { db }), SITE);
    expect(ld.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4, reviewCount: 1 });
  });

  it('нет в наличии → OutOfStock; локальное фото получает абсолютный адрес', async () => {
    const { db, cat } = await setup();
    addProduct(db, { name: 'Без остатка', slug: 'bez', categoryId: cat, inStock: false });
    const p = await getProductBySlug('bez', { db });
    const ld = productJsonLd({ ...p!, images: [{ src: '/api/catalog/media/a.webp', alt: 'x', remote: false }] }, { average: null, count: 0 }, SITE);
    expect(ld.offers?.availability).toBe('https://schema.org/OutOfStock');
    expect(ld.image).toEqual([`${SITE}/api/catalog/media/a.webp`]);
  });
});

describe('JSON-LD Organization', () => {
  it('только заданные поля: без телефона и адреса их нет', () => {
    const ld = organizationJsonLd({ siteName: 'РемТехСад', phone: null, address: null, email: null }, SITE);
    expect(ld).toEqual({ '@context': 'https://schema.org', '@type': 'Organization', name: 'РемТехСад', url: SITE });
  });
  it('с настройками добавляет телефон, адрес, email', () => {
    const ld = organizationJsonLd({ siteName: 'РемТехСад', phone: '+7 900 000-00-00', address: 'г. Тест, ул. Садовая, 1', email: 'a@b.ru' }, SITE);
    expect(ld).toMatchObject({ telephone: '+7 900 000-00-00', email: 'a@b.ru', address: { '@type': 'PostalAddress', streetAddress: 'г. Тест, ул. Садовая, 1' } });
  });
});

describe('metadata товара', () => {
  it('использует product_seo, иначе название и описание; canonical и OG', async () => {
    const { db, id } = await setup();
    const p = await getProductBySlug('trimmer-t523', { db });
    const plain = productMetadata(p!, getProductSeo(id, { db }));
    expect(plain.title).toBe('Триммер T523');
    expect(plain.description).toBe('Лёгкий триммер');
    expect(plain.alternates?.canonical).toBe('/product/trimmer-t523');

    db.prepare('INSERT INTO product_seo (product_id, seo_title, seo_description, updated_at) VALUES (?, ?, ?, 1)').run(id, 'Купить T523', 'Своё описание');
    const custom = productMetadata(p!, getProductSeo(id, { db }));
    expect(custom.title).toBe('Купить T523');
    expect(custom.description).toBe('Своё описание');
    expect(custom.openGraph).toMatchObject({ title: 'Купить T523', url: '/product/trimmer-t523' });
  });
});

describe('metadata категории', () => {
  const category = { id: 1, slug: 'trimmery', name: 'Триммеры', h1: null, seoTitle: null, seoDescription: null, seoText: null, parentId: null };

  it('чистый каталог индексируется с canonical на себя', () => {
    const m = categoryMetadata(category, {});
    expect(m.robots).toBeUndefined();
    expect(m.alternates?.canonical).toBe('/catalog/trimmery');
  });
  it('?page=N индексируется со своим canonical; page=1 — чистый адрес', () => {
    expect(categoryMetadata(category, { page: '3' }).alternates?.canonical).toBe('/catalog/trimmery?page=3');
    expect(categoryMetadata(category, { page: '3' }).robots).toBeUndefined();
    expect(categoryMetadata(category, { page: '1' }).alternates?.canonical).toBe('/catalog/trimmery');
  });
  it('фильтры, сортировка, цена, наличие, текст — noindex и canonical на чистый URL', () => {
    for (const sp of [{ sort: 'price_asc' }, { a5: 'x' }, { min: '100' }, { stock: '1' }, { q: 'абв' }, { sort: 'price_asc', page: '2' }]) {
      const m = categoryMetadata(category, sp);
      expect(m.robots).toMatchObject({ index: false });
      expect(m.alternates?.canonical).toBe('/catalog/trimmery');
      expect(isFilteredCatalog(sp)).toBe(true);
    }
  });
  it('seo-поля категории важнее названия', () => {
    const m = categoryMetadata({ ...category, seoTitle: 'T', seoDescription: 'D' }, {});
    expect(m.title).toBe('T');
    expect(m.description).toBe('D');
  });
});
