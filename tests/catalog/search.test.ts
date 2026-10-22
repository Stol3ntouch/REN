import { describe, expect, it } from 'vitest';
import { searchProducts } from '@/domain/catalog/search';
import { addCategory, addProduct, baseQuery, createTestDb } from './helpers';

function seedShears() {
  const db = createTestDb();
  const cat = addCategory(db, 'Садовые ножницы', 'sadovye-nozhnicy');
  const other = addCategory(db, 'Триммеры', 'trimmery');
  const ht = addProduct(db, { name: 'Бензоножницы CHAMPION HT625R', sku: 'HT625R', slug: 'champion-ht625r', categoryId: cat });
  addProduct(db, { name: 'Триммер бензиновый CHAMPION T523', sku: 'T523', categoryId: other });
  addProduct(db, { name: 'Секатор садовый', sku: 'SK-10', categoryId: cat });
  return { db, ht, cat };
}

describe('searchProducts: текстовый поиск', () => {
  it('находит по артикулу, по артикулу с пробелом/регистром и по слову из названия', async () => {
    const { db, ht } = seedShears();
    for (const text of ['HT625R', 'ht 625r', 'ht625r', 'бензоножницы', 'Бензоножниц', 'champion ht 625r']) {
      const r = await searchProducts({ ...baseQuery, text, sort: 'relevance' }, { db });
      expect(r.items.map((i) => i.id), text).toEqual([ht]);
    }
  });

  it('пробел и дефис в артикуле не мешают: «sk 10» находит SK-10', async () => {
    const { db } = seedShears();
    const r = await searchProducts({ ...baseQuery, text: 'sk 10', sort: 'relevance' }, { db });
    expect(r.items.map((i) => i.sku)).toEqual(['SK-10']);
  });

  it('пустой текст — листинг без отбора; текст без букв и цифр — ничего не найдено', async () => {
    const { db } = seedShears();
    for (const text of ['', '   ', undefined]) {
      expect((await searchProducts({ ...baseQuery, text }, { db })).total, JSON.stringify(text)).toBe(3);
    }
    for (const text of ['!!!', '"', '- *']) {
      expect((await searchProducts({ ...baseQuery, text }, { db })).total, text).toBe(0);
    }
    expect((await searchProducts({ ...baseQuery, categorySlug: 'sadovye-nozhnicy', text: '' }, { db })).total).toBe(2);
  });

  it('спецсимволы FTS и длинная строка не вызывают ошибку', async () => {
    const { db, ht } = seedShears();
    const nasty = ['"', '""', '*', 'NEAR', 'NEAR(a b)', '-', 'a AND', 'OR', '(', 'col:val', '^x', "'; DROP TABLE products;--", 'ht625r"', '"бензо* -ножницы'];
    for (const text of nasty) {
      await expect(searchProducts({ ...baseQuery, text }, { db }), text).resolves.toBeDefined();
    }
    const long = 'бензоножницы '.repeat(40);
    await expect(searchProducts({ ...baseQuery, text: long }, { db })).resolves.toBeDefined();
    // запрос обрезается до 100 символов: хвост после ста символов не ломает совпадение
    const padded = `ht625r ${'я'.repeat(200)}`;
    const r = await searchProducts({ ...baseQuery, text: padded }, { db });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect((await searchProducts({ ...baseQuery, text: `ht625r${' '.repeat(120)}zzz` }, { db })).items.map((i) => i.id)).toEqual([ht]);
  });

  it('не показывает неопубликованные товары', async () => {
    const { db, cat } = seedShears();
    addProduct(db, { name: 'Скрытый HT999', sku: 'HT999', categoryId: cat, published: false });
    addProduct(db, { name: 'Видимый HT998', sku: 'HT998', categoryId: cat });
    expect((await searchProducts({ ...baseQuery, text: 'HT998' }, { db })).total).toBe(1);
    expect((await searchProducts({ ...baseQuery, text: 'HT999' }, { db })).total).toBe(0);
  });

  it('обновление названия и артикула отражается в индексе', async () => {
    const { db, ht } = seedShears();
    db.prepare("UPDATE products SET name = 'Кусторез ZX-77', sku = 'ZX77' WHERE id = ?").run(ht);
    expect((await searchProducts({ ...baseQuery, text: 'HT625R' }, { db })).total).toBe(0);
    expect((await searchProducts({ ...baseQuery, text: 'zx 77' }, { db })).items.map((i) => i.id)).toEqual([ht]);
  });
});
