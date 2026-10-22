import { describe, expect, it } from 'vitest';
import { getFacets } from '@/domain/catalog/facets';
import { searchProducts } from '@/domain/catalog/search';
import { addCategory, addProduct, attributeId, baseQuery, createTestDb } from './helpers';

describe('getFacets: правило ≥3 товара и ≤30 значений', () => {
  it('характеристика у двух товаров категории фильтром не становится, у трёх — становится', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Триммеры', 'trimmery');
    for (let i = 0; i < 3; i += 1) {
      addProduct(db, { name: `Т${i}`, categoryId: cat, attrs: { Тип: i === 0 ? 'Бензиновый' : 'Электрический', Редкая: i < 2 ? 'да' : 'нет' } });
    }
    addProduct(db, { name: 'Без характеристик', categoryId: cat });
    // «Редкая» есть у всех трёх; уберём её у одного, чтобы осталось 2
    db.exec(`DELETE FROM product_attributes WHERE id IN (SELECT pa.id FROM product_attributes pa JOIN attribute_definitions d ON d.id = pa.attribute_id WHERE d.name = 'Редкая' LIMIT 1)`);
    const facets = await getFacets(cat, undefined, { db });
    expect(facets.map((f) => f.name)).toEqual(['Тип']);
    expect(facets[0]?.values).toEqual([
      { value: 'Бензиновый', count: 1 },
      { value: 'Электрический', count: 2 },
    ]);
  });

  it('30 различных значений — фильтр есть, 31 — нет', async () => {
    const db = createTestDb();
    const thirty = addCategory(db, 'Тридцать', 'thirty');
    const thirtyOne = addCategory(db, 'Тридцать одно', 'thirty-one');
    for (let i = 0; i < 31; i += 1) {
      addProduct(db, { name: `A${i}`, categoryId: thirtyOne, attrs: { Размер: `v${i}` } });
      if (i < 30) addProduct(db, { name: `B${i}`, categoryId: thirty, attrs: { Размер: `v${i}` } });
    }
    expect((await getFacets(thirty, undefined, { db })).map((f) => f.name)).toEqual(['Размер']);
    expect(await getFacets(thirtyOne, undefined, { db })).toEqual([]);
  });

  it('считает товары подкатегорий и не считает неопубликованные', async () => {
    const db = createTestDb();
    const root = addCategory(db, 'Корень', 'root');
    const sub = addCategory(db, 'Подкатегория', 'sub', root);
    addProduct(db, { name: 'A', categoryId: root, attrs: { Цвет: 'Красный' } });
    addProduct(db, { name: 'B', categoryId: sub, attrs: { Цвет: 'Красный' } });
    addProduct(db, { name: 'C', categoryId: sub, attrs: { Цвет: 'Синий' } });
    addProduct(db, { name: 'D', categoryId: sub, attrs: { Цвет: 'Синий' }, published: false });
    expect(await getFacets(sub, undefined, { db })).toEqual([]); // только 2 опубликованных товара
    const f = await getFacets(root, undefined, { db });
    expect(f[0]?.values).toEqual([
      { value: 'Красный', count: 2 },
      { value: 'Синий', count: 1 },
    ]);
  });

  it('счётчики совпадают с числом результатов при выборе значения и учитывают остальные фильтры', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Косилки', 'kosilki');
    const mk = (i: number, type: string, drive: string, inStock: boolean) =>
      addProduct(db, { name: `К${i}`, categoryId: cat, priceRub: 1000 + i, inStock, attrs: { Тип: type, Привод: drive } });
    mk(1, 'Бензиновая', 'Задний', true);
    mk(2, 'Бензиновая', 'Передний', true);
    mk(3, 'Бензиновая', 'Передний', false);
    mk(4, 'Электрическая', 'Задний', true);
    mk(5, 'Электрическая', 'Передний', true);
    const type = attributeId(db, 'Тип');
    const drive = attributeId(db, 'Привод');

    const ctx = { filters: { [drive]: ['Передний'] }, inStockOnly: true };
    const facets = await getFacets(cat, ctx, { db });
    const typeFacet = facets.find((f) => f.name === 'Тип');
    expect(typeFacet?.values).toEqual([
      { value: 'Бензиновая', count: 1 },
      { value: 'Электрическая', count: 1 },
    ]);
    // фильтр самой характеристики не сужает её же счётчики: «Привод» показывает оба значения
    const driveFacet = facets.find((f) => f.name === 'Привод');
    expect(driveFacet?.values).toEqual([
      { value: 'Задний', count: 2 },
      { value: 'Передний', count: 2 },
    ]);
    // счётчик = размер выдачи, если выбрать это значение
    for (const v of typeFacet?.values ?? []) {
      const r = await searchProducts({ ...baseQuery, categorySlug: 'kosilki', filters: { ...ctx.filters, [type]: [v.value] }, inStockOnly: true }, { db });
      expect(r.total, v.value).toBe(v.count);
    }
  });
});
