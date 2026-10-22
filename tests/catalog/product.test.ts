import { describe, expect, it } from 'vitest';
import { getProductBySlug, getRelatedProducts } from '@/domain/catalog/product';
import { imagesRepo } from '@/server/db/repositories/images';
import { addCategory, addProduct, createTestDb } from './helpers';

describe('getProductBySlug', () => {
  it('возвращает карточку: цена, наличие, характеристики в порядке, фото, крошки', async () => {
    const db = createTestDb();
    const root = addCategory(db, 'Садовая техника', 'sadovaya');
    const cat = addCategory(db, 'Триммеры', 'trimmery', root);
    const id = addProduct(db, {
      name: 'Триммер CHAMPION T523',
      slug: 'champion-t523',
      sku: 'T523',
      categoryId: cat,
      priceRub: 8990,
      discountRub: 7990,
      description: '<p>Описание</p>',
      attrs: { Мощность: '1 кВт', Тип: 'Бензиновый' },
      images: ['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg'],
    });
    const p = await getProductBySlug('champion-t523', { db });
    expect(p).toMatchObject({
      id,
      name: 'Триммер CHAMPION T523',
      sku: 'T523',
      unitKopecks: 799000,
      originalKopecks: 899000,
      inStock: true,
      descriptionHtml: '<p>Описание</p>',
    });
    expect(p?.attributes).toEqual([
      { name: 'Мощность', value: '1 кВт' },
      { name: 'Тип', value: 'Бензиновый' },
    ]);
    expect(p?.images.map((i) => [i.src, i.remote])).toEqual([
      ['https://champion.ru/a.jpg', true],
      ['https://champion.ru/b.jpg', true],
    ]);
    expect(p?.images[0]?.alt).toBe('Триммер CHAMPION T523');
    expect(p?.category.slug).toBe('trimmery');
    expect(p?.breadcrumbs.map((b) => b.name)).toEqual(['Садовая техника', 'Триммеры']);
  });

  it('скачанное фото отдаётся локальным путём нужного размера, а не внешней ссылкой', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const id = addProduct(db, { name: 'Т', slug: 't', categoryId: cat, images: ['https://champion.ru/a.jpg'] });
    const img = imagesRepo.listByProduct(db, id)[0];
    expect(img).toBeDefined();
    imagesRepo.setStored(db, (img as { id: number }).id, {
      path: 'ab/full.webp',
      variants: [
        { key: 'thumb', width: 160, height: 120, path: 'ab/thumb.webp' },
        { key: 'large', width: 960, height: 720, path: 'ab/large.webp' },
      ],
    });
    const p = await getProductBySlug('t', { db });
    expect(p?.images[0]).toMatchObject({ src: '/api/catalog/media/ab/large.webp', remote: false, width: 960, height: 720 });
    expect(p?.thumbs[0]).toMatchObject({ src: '/api/catalog/media/ab/thumb.webp', remote: false });
  });

  it('нет товара или он не опубликован — null; без фото и характеристик — пустые списки', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    addProduct(db, { name: 'Скрыт', slug: 'hidden', categoryId: cat, published: false });
    addProduct(db, { name: 'Голый', slug: 'bare', categoryId: cat, inStock: false });
    expect(await getProductBySlug('hidden', { db })).toBeNull();
    expect(await getProductBySlug('missing', { db })).toBeNull();
    const bare = await getProductBySlug('bare', { db });
    expect(bare).toMatchObject({ inStock: false, images: [], attributes: [], descriptionHtml: null });
    expect(bare?.originalKopecks).toBeUndefined();
  });
});

describe('getRelatedProducts', () => {
  it('товары той же категории без самого товара и неопубликованных; в наличии выше', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const other = addCategory(db, 'Д', 'd');
    const me = addProduct(db, { name: 'Я', categoryId: cat });
    const out = addProduct(db, { name: 'Аа нет', categoryId: cat, inStock: false });
    const b = addProduct(db, { name: 'Бб', categoryId: cat });
    const c = addProduct(db, { name: 'Вв', categoryId: cat });
    addProduct(db, { name: 'Скрыт', categoryId: cat, published: false });
    addProduct(db, { name: 'Чужой', categoryId: other });
    const rel = await getRelatedProducts(me, { db });
    expect(rel.map((p) => p.id)).toEqual([b, c, out]);
  });

  it('ограничивает выдачу 8 товарами', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const me = addProduct(db, { name: 'Я', categoryId: cat });
    for (let i = 0; i < 12; i += 1) addProduct(db, { name: `Т${i}`, categoryId: cat });
    expect((await getRelatedProducts(me, { db })).length).toBe(8);
  });

  it('меньше двух связанных — пусто (блок скрыт)', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    const me = addProduct(db, { name: 'Я', categoryId: cat });
    expect(await getRelatedProducts(me, { db })).toEqual([]);
    addProduct(db, { name: 'Один', categoryId: cat });
    expect(await getRelatedProducts(me, { db })).toEqual([]);
    addProduct(db, { name: 'Два', categoryId: cat });
    expect((await getRelatedProducts(me, { db })).length).toBe(2);
  });
});
