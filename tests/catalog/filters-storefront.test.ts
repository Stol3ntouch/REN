import { describe, expect, it } from 'vitest';
import { attributeOps } from '@/app/admin/(panel)/_lib/attributes-ops';
import { filterOps } from '@/app/admin/(panel)/_lib/filters-ops';
import { facetContext, getFacets } from '@/domain/catalog/facets';
import { buildCatalogQueryString, parseCatalogParams } from '@/domain/catalog/params';
import { searchProducts } from '@/domain/catalog/search';
import type { CatalogQuery, Facet } from '@/domain/catalog/types';
import type { Db } from '@/server/db/connection';
import { brandsRepo } from '@/server/db/repositories/brands';
import { filtersRepo } from '@/server/db/repositories/filters';
import { admin, T0 } from '../admin/helpers';
import { addCategory, addProduct, attributeId, baseQuery, createTestDb } from './helpers';

const opts = (db: Db) => ({ db, now: T0 });
const brand = (db: Db, name: string, over: Partial<{ published: boolean }> = {}) =>
  brandsRepo.insert(db, { name, slug: name.toLowerCase(), description: null, siteUrl: null, published: over.published ?? true, sort: 0, seoTitle: null, seoDescription: null }, '2026-10-24T00:00:00Z');
const withBrand = (db: Db, productId: number, brandId: number) => brandsRepo.setProductBrand(db, productId, brandId);
const byKind = (facets: Facet[], kind: string) => facets.find((f) => f.kind === kind);
const kinds = (facets: Facet[]) => facets.map((f) => f.kind);
const total = async (db: Db, q: Partial<CatalogQuery>) => (await searchProducts({ ...baseQuery, ...q }, { db })).total;

function mowers(db: Db) {
  const cat = addCategory(db, 'Косилки', 'kosilki');
  const mk = (i: number, brandId: number | null, power: string, inStock = true) => {
    const id = addProduct(db, { name: `К${i}`, categoryId: cat, priceRub: 1000 * i, inStock, attrs: { Мощность: power, Тип: i % 2 ? 'Бензин' : 'Электро' } });
    if (brandId) withBrand(db, id, brandId);
    return id;
  };
  return { cat, mk };
}

describe('панель фильтров строится из настроенных фильтров', () => {
  it('по умолчанию: цена, наличие, затем характеристики; бренд без товаров с брендом не показывается', async () => {
    const db = createTestDb();
    const { cat, mk } = mowers(db);
    for (let i = 1; i <= 3; i++) mk(i, null, String(i));
    const facets = await getFacets(cat, undefined, { db });
    expect(kinds(facets)).toEqual(['price', 'stock', 'attribute', 'attribute']);
    expect(byKind(facets, 'price')?.range).toEqual({ min: 1000, max: 3000 });
  });

  it('выключенный фильтр исчезает, порядок задаётся в админке, характеристика вне фильтров не показывается', async () => {
    const db = createTestDb();
    const { cat, mk } = mowers(db);
    for (let i = 1; i <= 3; i++) mk(i, null, String(i));
    const power = filtersRepo.findByAttribute(db, Number(attributeId(db, 'Мощность')))!;
    const type = filtersRepo.findByAttribute(db, Number(attributeId(db, 'Тип')))!;
    const price = filtersRepo.findByKind(db, 'price')!;
    const stock = filtersRepo.findByKind(db, 'stock')!;

    filterOps.reorder(admin, [type.id, power.id, stock.id, price.id], opts(db));
    expect((await getFacets(cat, undefined, { db })).map((f) => f.name)).toEqual(['Тип', 'Мощность', 'Наличие', 'Цена, ₽']);

    filterOps.setEnabled(admin, stock.id, false, opts(db));
    filterOps.setEnabled(admin, price.id, false, opts(db));
    expect(kinds(await getFacets(cat, undefined, { db }))).toEqual(['attribute', 'attribute']);

    const def = attributeOps.get(admin, Number(attributeId(db, 'Тип')), opts(db))!;
    attributeOps.update(admin, def.id, { name: def.name, code: def.code, type: def.type, unit: '', required: false, filterable: false, comparable: true, sort: 0, categoryIds: [], allowedValues: [] }, opts(db));
    expect((await getFacets(cat, undefined, { db })).map((f) => f.name)).toEqual(['Мощность']);
  });

  it('ограничение по категориям: фильтр виден в выбранной категории и её потомках, но не в других', async () => {
    const db = createTestDb();
    const root = addCategory(db, 'Корень', 'root');
    const sub = addCategory(db, 'Под', 'sub', root);
    const other = addCategory(db, 'Чужая', 'other');
    for (const c of [root, sub, other]) for (let i = 0; i < 3; i++) addProduct(db, { name: `${c}-${i}`, categoryId: c, attrs: { Цвет: 'Красный' } });
    const color = filtersRepo.findByAttribute(db, Number(attributeId(db, 'Цвет')))!;
    filterOps.update(admin, color.id, { kind: 'attribute', attributeId: color.attributeId, label: 'Цвет', widget: 'checkbox', sort: 100, enabled: true, config: {}, categoryIds: [root] }, opts(db));
    const has = async (c: number) => (await getFacets(c, undefined, { db })).some((f) => f.name === 'Цвет');
    expect(await has(root)).toBe(true);
    expect(await has(sub)).toBe(true);
    expect(await has(other)).toBe(false);
  });

  it('пороги из конфигурации заменяют правило ≥3 товара / ≤30 значений', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'К', 'k');
    for (let i = 0; i < 2; i++) addProduct(db, { name: `Т${i}`, categoryId: cat, attrs: { Редкая: `v${i}` } });
    expect((await getFacets(cat, undefined, { db })).some((f) => f.name === 'Редкая')).toBe(false);
    const f = filtersRepo.findByAttribute(db, Number(attributeId(db, 'Редкая')))!;
    filterOps.update(admin, f.id, { kind: 'attribute', attributeId: f.attributeId, label: 'Редкая', widget: 'checkbox', sort: 100, enabled: true, config: { minProducts: 2, maxValues: 1 }, categoryIds: [] }, opts(db));
    expect((await getFacets(cat, undefined, { db })).some((x) => x.name === 'Редкая')).toBe(false); // 2 значения > 1
    filterOps.update(admin, f.id, { kind: 'attribute', attributeId: f.attributeId, label: 'Редкая', widget: 'checkbox', sort: 100, enabled: true, config: { minProducts: 2 }, categoryIds: [] }, opts(db));
    expect((await getFacets(cat, undefined, { db })).some((x) => x.name === 'Редкая')).toBe(true);
  });
});

describe('бренд, диапазон, подкатегории: выдача и счётчики совпадают', () => {
  it('фильтр по бренду сужает выдачу; счётчик значения = число результатов при его выборе (с учётом других фильтров)', async () => {
    const db = createTestDb();
    const { cat, mk } = mowers(db);
    const a = brand(db, 'Alpha');
    const b = brand(db, 'Beta');
    brand(db, 'Hidden', { published: false });
    mk(1, a, '1');
    mk(2, a, '2', false);
    mk(3, b, '3');
    mk(4, b, '4');
    mk(5, null, '5');
    const facets = await getFacets(cat, { filters: {}, inStockOnly: true }, { db });
    const bf = byKind(facets, 'brand')!;
    expect(bf.values).toEqual([
      { value: 'alpha', label: 'Alpha', count: 1 },
      { value: 'beta', label: 'Beta', count: 2 },
    ]);
    for (const v of bf.values) expect(await total(db, { categorySlug: 'kosilki', brands: [v.value], inStockOnly: true }), v.value).toBe(v.count);
    expect(await total(db, { categorySlug: 'kosilki', brands: ['alpha', 'beta'] })).toBe(4);
    expect(await total(db, { categorySlug: 'kosilki' })).toBe(5);
  });

  it('диапазон числовой характеристики: границы в панели и сужение выдачи', async () => {
    const db = createTestDb();
    const { cat, mk } = mowers(db);
    for (const p of ['1,5', '2', '3,5', '10', 'нет данных']) mk(Number(p.replace(',', '')) || 9, null, p);
    const def = attributeOps.get(admin, Number(attributeId(db, 'Мощность')), opts(db))!;
    attributeOps.update(admin, def.id, { name: 'Мощность', code: def.code, type: 'string', unit: '', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [] }, opts(db));
    // «нет данных» не число — тип number не назначить, пока такое значение есть
    expect(() => attributeOps.update(admin, def.id, { name: 'Мощность', code: def.code, type: 'number', unit: 'кВт', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [] }, opts(db))).toThrow(/нет данных/);
    db.prepare("DELETE FROM product_attributes WHERE value = 'нет данных'").run();
    attributeOps.update(admin, def.id, { name: 'Мощность', code: def.code, type: 'number', unit: 'кВт', required: false, filterable: true, comparable: true, sort: 0, categoryIds: [], allowedValues: [] }, opts(db));
    const f = filtersRepo.findByAttribute(db, def.id)!;
    filterOps.update(admin, f.id, { kind: 'attribute', attributeId: def.id, label: 'Мощность', widget: 'range', sort: 100, enabled: true, config: {}, categoryIds: [] }, opts(db));

    const facet = (await getFacets(cat, undefined, { db })).find((x) => x.name === 'Мощность')!;
    expect(facet).toMatchObject({ widget: 'range', unit: 'кВт', range: { min: 1.5, max: 10 }, key: `a${def.id}` });
    const id = String(def.id);
    expect(await total(db, { categorySlug: 'kosilki', ranges: { [id]: { min: 2, max: 4 } } })).toBe(2);
    expect(await total(db, { categorySlug: 'kosilki', ranges: { [id]: { min: 5 } } })).toBe(1);
    expect(await total(db, { categorySlug: 'kosilki', ranges: { [id]: { max: 1.5 } } })).toBe(1);
    // границы собственного диапазона при его выборе не сужаются
    const narrowed = (await getFacets(cat, { filters: {}, ranges: { [id]: { min: 5 } } }, { db })).find((x) => x.name === 'Мощность')!;
    expect(narrowed.range).toEqual({ min: 1.5, max: 10 });
  });

  it('фильтр «подкатегория» (включённый админом): значения — дети категории, выбор сужает выдачу с потомками', async () => {
    const db = createTestDb();
    const root = addCategory(db, 'Техника', 'tehnika');
    const a = addCategory(db, 'А', 'a', root);
    const a1 = addCategory(db, 'А1', 'a1', a);
    const b = addCategory(db, 'Б', 'b', root);
    addProduct(db, { name: 'x1', categoryId: a });
    addProduct(db, { name: 'x2', categoryId: a1 });
    addProduct(db, { name: 'x3', categoryId: b });
    expect(byKind(await getFacets(root, undefined, { db }), 'category')).toBeUndefined();
    filterOps.setEnabled(admin, filtersRepo.findByKind(db, 'category')!.id, true, opts(db));
    const f = byKind(await getFacets(root, undefined, { db }), 'category')!;
    expect(f.values).toEqual([
      { value: 'a', label: 'А', count: 2 },
      { value: 'b', label: 'Б', count: 1 },
    ]);
    expect(await total(db, { categorySlug: 'tehnika', subcategories: ['a'] })).toBe(2);
    expect(await total(db, { categorySlug: 'tehnika', subcategories: ['a', 'b'] })).toBe(3);
    expect(await total(db, { categorySlug: 'tehnika', subcategories: ['net-takoy'] })).toBe(3);
  });

  it('поиск без категории: цена, наличие и бренд; характеристики не показываются', async () => {
    const db = createTestDb();
    const { mk } = mowers(db);
    const a = brand(db, 'Alpha');
    for (let i = 1; i <= 3; i++) mk(i, a, String(i));
    const facets = await getFacets(null, { filters: {} }, { db });
    expect(kinds(facets)).toEqual(['price', 'stock', 'brand']);
  });
});

describe('адрес: бренд, диапазон, подкатегории', () => {
  it('разбирается и собирается обратно; мусор отбрасывается', () => {
    const sp = new URLSearchParams('brand=alpha&brand=beta&sub=a1&a7_min=2,5&a7_max=10&a8_min=abc&brand=Bad Slug&a9_max=-3');
    const q = parseCatalogParams(sp);
    expect(q.brands).toEqual(['alpha', 'beta']);
    expect(q.subcategories).toEqual(['a1']);
    expect(q.ranges).toEqual({ '7': { min: 2.5, max: 10 }, '9': { max: -3 } });
    const back = parseCatalogParams(new URLSearchParams(buildCatalogQueryString(q)));
    expect(back).toEqual(q);
    expect(parseCatalogParams({}).brands).toBeUndefined();
    expect(facetContext(q).brands).toEqual(['alpha', 'beta']);
  });
});

describe('производительность фасетов', () => {
  it('категория с 33 характеристиками: не больше одного запроса на фильтр-группу, без N+1', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Генераторы', 'generatory');
    const attrs = (i: number) => Object.fromEntries(Array.from({ length: 33 }, (_, k) => [`Характеристика ${k}`, `значение ${(i + k) % 4}`]));
    for (let i = 0; i < 40; i++) addProduct(db, { name: `Г${i}`, categoryId: cat, priceRub: 1000 + i, attrs: attrs(i) });

    let queries = 0;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const st = prepare(sql);
      for (const m of ['all', 'get', 'run'] as const) {
        const orig = st[m].bind(st) as (...a: unknown[]) => unknown;
        (st as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
          queries += 1;
          return orig(...a);
        };
      }
      return st;
    }) as typeof db.prepare;

    const facets = await getFacets(cat, { filters: {} }, { db });
    const groups = facets.length;
    expect(facets.filter((f) => f.kind === 'attribute')).toHaveLength(33);
    expect(groups).toBe(35); // 33 характеристики + цена + наличие
    expect(queries).toBeLessThanOrEqual(groups + 4);
    // по одному запросу на группу + служебные (чтение категорий и фильтров, проверка правила для всех характеристик сразу)
    expect(queries).toBe(groups + 4); // зафиксировано: 35 групп + 4 служебных (категории, фильтры, правило и одно чтение сверх)
  });
});
