import { describe, expect, it, vi } from 'vitest';
import { clearCategoryImageCache, getCategoryImage, getCategoryImages } from '@/domain/catalog/category-images';
import { imagesRepo } from '@/server/db/repositories/images';
import { addCategory, addProduct, createTestDb } from './helpers';

describe('getCategoryImages', () => {
  it('берёт фото товара дочерней категории для родительской, alt — название категории', () => {
    const db = createTestDb();
    const garden = addCategory(db, 'Садовая техника', 'sad');
    const trimmers = addCategory(db, 'Триммеры', 'trim', garden);
    addProduct(db, { name: 'Триммер X', categoryId: trimmers, images: ['https://champion.ru/a.jpg'] });
    const map = getCategoryImages([garden, trimmers], { db });
    expect(map.get(garden)).toMatchObject({ src: 'https://champion.ru/a.jpg', alt: 'Садовая техника', remote: true });
    expect(map.get(trimmers)).toMatchObject({ src: 'https://champion.ru/a.jpg', alt: 'Триммеры' });
  });

  it('предпочитает товар в наличии', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Насосы', 'nasosy');
    addProduct(db, { name: 'нет в наличии', categoryId: cat, inStock: false, images: ['https://champion.ru/out.jpg'] });
    addProduct(db, { name: 'есть', categoryId: cat, inStock: true, images: ['https://champion.ru/in.jpg'] });
    expect(getCategoryImage(cat, { db })?.src).toBe('https://champion.ru/in.jpg');
  });

  it('нет фото (или товар не опубликован) → null', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Пустая', 'pusto');
    const other = addCategory(db, 'Скрытая', 'skryto');
    addProduct(db, { name: 'без фото', categoryId: cat });
    addProduct(db, { name: 'скрыт', categoryId: other, published: false, images: ['https://champion.ru/h.jpg'] });
    const map = getCategoryImages([cat, other, 99999], { db });
    expect(map.get(cat)).toBeNull();
    expect(map.get(other)).toBeNull();
    expect(map.get(99999)).toBeNull();
  });

  it('локальный вариант нужного размера через media-маршрут, иначе внешний url', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Мойки', 'moyki');
    const id = addProduct(db, { name: 'Мойка', categoryId: cat, images: ['https://champion.ru/m.jpg'] });
    const row = imagesRepo.listByProduct(db, id)[0]!;
    imagesRepo.setStored(db, row.id, {
      path: 'ab/full.webp',
      variants: [
        { key: 'thumb', width: 160, height: 120, path: 'ab/thumb.webp' },
        { key: 'card', width: 480, height: 360, path: 'ab/card.webp' },
      ],
    });
    expect(getCategoryImage(cat, { db, size: 'card' })).toMatchObject({ src: '/api/catalog/media/ab/card.webp', remote: false, width: 480, height: 360 });
    clearCategoryImageCache();
    expect(getCategoryImage(cat, { db, size: 'thumb' })?.src).toBe('/api/catalog/media/ab/thumb.webp');
  });

  it('выбор стабилен между запросами и не зависит от порядка id', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Культиваторы', 'kult');
    addProduct(db, { name: 'б', categoryId: cat, images: ['https://champion.ru/1.jpg'] });
    addProduct(db, { name: 'а', categoryId: cat, images: ['https://champion.ru/2.jpg'] });
    const first = getCategoryImage(cat, { db })?.src;
    clearCategoryImageCache();
    expect(getCategoryImage(cat, { db })?.src).toBe(first);
    expect(getCategoryImages([cat], { db }).get(cat)?.src).toBe(first);
  });

  it('одна выборка на пачку: число запросов не растёт с числом категорий, повтор идёт из кэша', () => {
    const db = createTestDb();
    const ids = Array.from({ length: 6 }, (_, i) => addCategory(db, `К${i}`, `k${i}`));
    ids.forEach((id, i) => addProduct(db, { name: `т${i}`, categoryId: id, images: [`https://champion.ru/${i}.jpg`] }));
    const spy = vi.spyOn(db, 'prepare');
    getCategoryImages(ids, { db });
    const afterBatch = spy.mock.calls.length;
    expect(afterBatch).toBeLessThanOrEqual(2);
    getCategoryImages(ids, { db });
    getCategoryImage(ids[0]!, { db });
    expect(spy.mock.calls.length).toBe(afterBatch);
  });

  it('кэш сбрасывается по времени (5 минут)', () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Пилы', 'pily');
    addProduct(db, { name: 'пила', categoryId: cat });
    const t0 = 1_000_000;
    expect(getCategoryImage(cat, { db, now: t0 })).toBeNull();
    addProduct(db, { name: 'пила 2', categoryId: cat, images: ['https://champion.ru/p.jpg'] });
    expect(getCategoryImage(cat, { db, now: t0 + 60_000 })).toBeNull();
    expect(getCategoryImage(cat, { db, now: t0 + 5 * 60_000 + 1 })?.src).toBe('https://champion.ru/p.jpg');
  });
});
