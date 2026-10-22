import { afterEach, describe, expect, it } from 'vitest';
import { setPopularitySource } from '@/domain/catalog/popularity';
import { searchProducts } from '@/domain/catalog/search';
import { addCategory, addProduct, attributeId, baseQuery, createTestDb } from './helpers';

afterEach(() => setPopularitySource(null));

function seedTree() {
  const db = createTestDb();
  const root = addCategory(db, 'Садовая техника', 'sadovaya-tehnika');
  const sub = addCategory(db, 'Триммеры', 'trimmery', root);
  const other = addCategory(db, 'Насосы', 'nasosy');
  return { db, root, sub, other };
}

describe('searchProducts: категория', () => {
  it('категория включает товары подкатегорий, чужая категория — нет', async () => {
    const { db, root, sub, other } = seedTree();
    const a = addProduct(db, { name: 'Грабли', categoryId: root });
    const b = addProduct(db, { name: 'Триммер', categoryId: sub });
    addProduct(db, { name: 'Насос', categoryId: other });
    const r = await searchProducts({ ...baseQuery, categorySlug: 'sadovaya-tehnika' }, { db });
    expect(r.items.map((i) => i.id).sort()).toEqual([a, b].sort());
    expect((await searchProducts({ ...baseQuery, categorySlug: 'net-takoy' }, { db })).total).toBe(0);
  });
});

describe('searchProducts: сортировка', () => {
  it('по имени без учёта регистра и по цене; при равенстве — по id', async () => {
    const { db, root } = seedTree();
    const b = addProduct(db, { name: 'бензопила', categoryId: root, priceRub: 500 });
    const a = addProduct(db, { name: 'Аккумулятор', categoryId: root, priceRub: 500 });
    const c = addProduct(db, { name: 'Грабли', categoryId: root, priceRub: 100 });
    const d1 = addProduct(db, { name: 'Дубль', categoryId: root, priceRub: 900 });
    const d2 = addProduct(db, { name: 'Дубль', categoryId: root, priceRub: 900 });
    const ids = async (sort: 'name' | 'price_asc' | 'price_desc') => (await searchProducts({ ...baseQuery, sort }, { db })).items.map((i) => i.id);
    expect(await ids('name')).toEqual([a, b, c, d1, d2]);
    expect(await ids('price_asc')).toEqual([c, a, b, d1, d2]);
    expect(await ids('price_desc')).toEqual([d1, d2, a, b, c]);
  });

  it('цена для сортировки и фильтра — скидочная, если она ниже обычной', async () => {
    const { db, root } = seedTree();
    const cheap = addProduct(db, { name: 'Скидка', categoryId: root, priceRub: 1000, discountRub: 300 });
    const mid = addProduct(db, { name: 'Обычный', categoryId: root, priceRub: 500 });
    expect((await searchProducts({ ...baseQuery, sort: 'price_asc' }, { db })).items.map((i) => i.id)).toEqual([cheap, mid]);
    const r = await searchProducts({ ...baseQuery, priceMax: 40000 }, { db });
    expect(r.items.map((i) => i.id)).toEqual([cheap]);
    expect(r.items[0]).toMatchObject({ unitKopecks: 30000, originalKopecks: 100000 });
    expect((await searchProducts({ ...baseQuery }, { db })).items.find((i) => i.id === mid)?.originalKopecks).toBeUndefined();
  });

  it('популярность без источника заказов вырождается в алфавит', async () => {
    const { db, root } = seedTree();
    const z = addProduct(db, { name: 'Ящик', categoryId: root });
    const a = addProduct(db, { name: 'Бур', categoryId: root });
    const popular = await searchProducts({ ...baseQuery, sort: 'popular' }, { db });
    expect(popular.items.map((i) => i.id)).toEqual([a, z]);
  });

  it('популярность с подключённым источником: больше единиц в заказах — выше, остальные по алфавиту', async () => {
    const { db, root } = seedTree();
    const a = addProduct(db, { name: 'Аа', categoryId: root });
    const b = addProduct(db, { name: 'Бб', categoryId: root });
    const c = addProduct(db, { name: 'Вв', categoryId: root });
    db.exec('CREATE TABLE test_sales (product_id INTEGER, qty INTEGER, cancelled INTEGER)');
    db.prepare('INSERT INTO test_sales VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)').run(c, 5, 0, b, 2, 0, a, 100, 1);
    setPopularitySource(() => 'SELECT product_id AS id, SUM(qty) AS units FROM test_sales WHERE cancelled = 0 GROUP BY product_id');
    const r = await searchProducts({ ...baseQuery, sort: 'popular' }, { db });
    expect(r.items.map((i) => i.id)).toEqual([c, b, a]);
  });
});

describe('searchProducts: страницы', () => {
  it('страницы 1 и 2 не пересекаются, суммарно дают все товары; hasMore верен', async () => {
    const { db, root } = seedTree();
    for (let i = 1; i <= 45; i += 1) addProduct(db, { name: `Товар ${String(i).padStart(2, '0')}`, categoryId: root, priceRub: 100 });
    const p1 = await searchProducts({ ...baseQuery, page: 1 }, { db });
    const p2 = await searchProducts({ ...baseQuery, page: 2 }, { db });
    const p3 = await searchProducts({ ...baseQuery, page: 3 }, { db });
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([20, 20, 5]);
    expect([p1.hasMore, p2.hasMore, p3.hasMore]).toEqual([true, true, false]);
    expect(p1.total).toBe(45);
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(new Set(all).size).toBe(45);
    // одинаковые цены: порядок по цене стабилен между страницами
    const s1 = await searchProducts({ ...baseQuery, sort: 'price_asc', page: 1 }, { db });
    const s2 = await searchProducts({ ...baseQuery, sort: 'price_asc', page: 2 }, { db });
    expect(new Set([...s1.items, ...s2.items].map((i) => i.id)).size).toBe(40);
  });
});

describe('searchProducts: фильтры', () => {
  it('характеристика, цена и «только в наличии» сочетаются по И', async () => {
    const { db, root } = seedTree();
    const a = addProduct(db, { name: 'А', categoryId: root, priceRub: 1000, attrs: { Тип: 'Бензиновый' } });
    addProduct(db, { name: 'Б', categoryId: root, priceRub: 1000, attrs: { Тип: 'Электрический' } });
    addProduct(db, { name: 'В', categoryId: root, priceRub: 1000, attrs: { Тип: 'Бензиновый' }, inStock: false });
    addProduct(db, { name: 'Г', categoryId: root, priceRub: 9000, attrs: { Тип: 'Бензиновый' } });
    const type = attributeId(db, 'Тип');
    const base = { ...baseQuery, filters: { [type]: ['Бензиновый'] } };
    expect((await searchProducts(base, { db })).total).toBe(3);
    expect((await searchProducts({ ...base, inStockOnly: true }, { db })).total).toBe(2);
    const r = await searchProducts({ ...base, inStockOnly: true, priceMax: 500000 }, { db });
    expect(r.items.map((i) => i.id)).toEqual([a]);
    // несколько значений одной характеристики — ИЛИ
    expect((await searchProducts({ ...baseQuery, filters: { [type]: ['Бензиновый', 'Электрический'] } }, { db })).total).toBe(4);
  });
});
