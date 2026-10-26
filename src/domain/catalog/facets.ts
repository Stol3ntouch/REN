import { visibleProductSql } from '@/server/db/repositories/products';
import { getDb, type Db } from '@/server/db/connection';
import { facetsConfigRepo, type StorefrontFilter } from '@/server/db/repositories/facets-config';
import { ancestorsOf } from './attributes';
import { applyCategoryFilterSettings } from './category-filters';
import { listCategoryRows } from './category-rows';
import { DEFAULT_MAX_VALUES, DEFAULT_MIN_PRODUCTS, filterAppliesToCategory } from './filters';
import { buildMatchQuery } from './fts';
import { buildScope, descendantIds, EFFECTIVE_PRICE, IN_CATEGORIES, resolveSubcategories, type Scope } from './store';
import type { CatalogQuery, Facet, FacetContext, FacetValue } from './types';

/** Контекст фасетов из запроса каталога (все активные фильтры, кроме страницы и сортировки). */
export function facetContext(q: CatalogQuery): FacetContext {
  return {
    text: q.text,
    filters: q.filters,
    priceMin: q.priceMin,
    priceMax: q.priceMax,
    inStockOnly: q.inStockOnly,
    brands: q.brands,
    ranges: q.ranges,
    subcategories: q.subcategories,
  };
}

type SqlValue = string | number | null;
type AttrStat = { products: number; values: number; numericProducts: number };

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/**
 * Панель фильтров витрины: фильтры, настроенные в админке (включённые, в заданном порядке, с учётом ограничения по категориям).
 * categoryId = null — каталог без категории (поиск): только цена, наличие и бренд; фильтры характеристик и подкатегорий не применимы.
 *
 * Правило для фильтров характеристик (по умолчанию то же, что было до настройки): характеристика показывается в категории,
 * если она есть у ≥3 опубликованных товаров категории и имеет ≤30 различных значений (пороги — в config фильтра).
 * Правило считается по всей категории, а не по текущей выдаче, поэтому фильтры не пропадают при выборе значений.
 * Счётчик значения = сколько товаров будет в выдаче, если выбрать это значение при остальных активных фильтрах
 * (фильтр самой группы при её подсчёте не применяется).
 *
 * Запросов к БД: чтение категорий и фильтров, одна проверка правила для всех характеристик, затем РОВНО один запрос на фильтр-группу.
 */
export async function getFacets(categoryId: number | null, ctx: FacetContext = { filters: {} }, opts: { db?: Db } = {}): Promise<Facet[]> {
  const db = opts.db ?? getDb();
  const rows = listCategoryRows(db);
  const categoryIds = categoryId === null ? undefined : descendantIds(rows, categoryId);
  const chain = categoryId === null ? null : ancestorsOf(categoryId, new Map(rows.map((r) => [r.id, r.parentId])));

  const applicable = applyCategoryFilterSettings(
    facetsConfigRepo
      .listEnabled(db)
      .filter((f) => filterAppliesToCategory(f.categoryIds, chain) && (categoryId !== null || (f.kind !== 'attribute' && f.kind !== 'category'))),
    chain ?? [],
  );
  if (applicable.length === 0) return [];

  const text = (ctx.text ?? '').trim();
  const match = text === '' ? null : buildMatchQuery(text);
  const base: Scope = {
    categoryIds,
    subCategoryIds: resolveSubcategories(db, categoryIds, ctx.subcategories),
    match,
    text: ctx.text,
    filters: ctx.filters,
    priceMin: ctx.priceMin,
    priceMax: ctx.priceMax,
    inStockOnly: ctx.inStockOnly,
    brands: ctx.brands,
    ranges: ctx.ranges,
  };

  const idsJson = categoryIds ? JSON.stringify(categoryIds) : null;
  const catWhere = idsJson ? `AND ${IN_CATEGORIES}` : '';
  const catParams: SqlValue[] = idsJson ? [idsJson] : [];
  const visible = visibleProductSql('p');

  // Правило «≥N товаров, ≤M значений» — одним запросом для всех характеристик-фильтров.
  const attrFilters = applicable.filter((f) => f.kind === 'attribute' && f.attribute);
  const stats = new Map<number, AttrStat>();
  if (attrFilters.length > 0 && idsJson) {
    const found = db
      .prepare(
        `SELECT pa.attribute_id AS id, COUNT(DISTINCT p.id) AS products, COUNT(DISTINCT pa.value) AS vals,
                COUNT(DISTINCT CASE WHEN pa.value_num IS NOT NULL THEN p.id END) AS numeric_products
         FROM product_attributes pa JOIN products p ON p.id = pa.product_id
         WHERE ${visible} AND ${IN_CATEGORIES} AND pa.attribute_id IN (SELECT value FROM json_each(?))
         GROUP BY pa.attribute_id`,
      )
      .all(idsJson, JSON.stringify(attrFilters.map((f) => (f.attribute as { id: number }).id))) as { id: number; products: number; vals: number; numeric_products: number }[];
    for (const r of found) stats.set(r.id, { products: r.products, values: r.vals, numericProducts: r.numeric_products });
  }

  // Порядок: заданный в админке; при равенстве у характеристик — больше товаров в категории, затем название (как было).
  const productsOf = (f: StorefrontFilter) => (f.attribute ? (stats.get(f.attribute.id)?.products ?? 0) : 0);
  const ordered = [...applicable].sort(
    (a, b) => a.sort - b.sort || productsOf(b) - productsOf(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || a.id - b.id,
  );

  const facets: Facet[] = [];
  for (const f of ordered) {
    const built = buildFacet(db, f, { base, stats, visible, catWhere, catParams, categoryId, rows });
    if (built) facets.push(built);
  }
  return facets;
}

type Env = {
  base: Scope;
  stats: Map<number, AttrStat>;
  visible: string;
  catWhere: string;
  catParams: SqlValue[];
  categoryId: number | null;
  rows: ReturnType<typeof listCategoryRows>;
};

function buildFacet(db: Db, f: StorefrontFilter, env: Env): Facet | null {
  const common = { filterId: f.id, name: f.label, widget: f.widget };
  switch (f.kind) {
    case 'price': {
      const b = buildScope(env.base, 'price');
      const r = db.prepare(`SELECT MIN(${EFFECTIVE_PRICE}) AS lo, MAX(${EFFECTIVE_PRICE}) AS hi FROM products p ${b.joins} WHERE ${b.where}`).get(...b.params) as {
        lo: number | null;
        hi: number | null;
      };
      return { ...common, id: f.id, key: 'price', kind: 'price', widget: 'range', values: [], range: r.lo === null || r.hi === null ? null : { min: Math.floor(r.lo / 100), max: Math.ceil(r.hi / 100) } };
    }
    case 'stock': {
      const b = buildScope(env.base, 'stock');
      const r = db.prepare(`SELECT COUNT(*) AS n FROM products p ${b.joins} WHERE ${b.where} AND p.in_stock = 1`).get(...b.params) as { n: number };
      return { ...common, id: f.id, key: 'stock', kind: 'stock', widget: 'checkbox', values: [{ value: '1', label: 'Только в наличии', count: r.n }] };
    }
    case 'brand': {
      const b = buildScope(env.base, 'brand');
      const found = db
        .prepare(
          `WITH scoped AS (SELECT p.id FROM products p ${b.joins} WHERE ${b.where})
           SELECT br.slug AS slug, br.name AS name, br.sort AS sort, COUNT(DISTINCT s.id) AS n
           FROM products p JOIN brands br ON br.id = p.brand_id LEFT JOIN scoped s ON s.id = p.id
           WHERE ${env.visible} ${env.catWhere} AND br.published = 1 AND br.archived = 0
           GROUP BY br.id`,
        )
        .all(...b.params, ...env.catParams) as { slug: string; name: string; sort: number; n: number }[];
      if (found.length === 0) return null;
      const values = found
        .sort((x, y) => x.sort - y.sort || collator.compare(x.name, y.name) || (x.slug < y.slug ? -1 : 1))
        .map((r): FacetValue => ({ value: r.slug, label: r.name, count: r.n }));
      return { ...common, id: f.id, key: 'brand', kind: 'brand', widget: f.widget === 'select' ? 'select' : 'checkbox', values };
    }
    case 'category': {
      if (env.categoryId === null) return null;
      const children = env.rows.filter((r) => r.parentId === env.categoryId).sort((x, y) => x.sort - y.sort || collator.compare(x.name, y.name) || x.id - y.id);
      if (children.length === 0) return null;
      const b = buildScope(env.base, 'sub');
      const per = db.prepare(`SELECT pc.category_id AS cid, COUNT(DISTINCT p.id) AS n FROM products p JOIN product_categories pc ON pc.product_id = p.id ${b.joins} WHERE ${b.where} GROUP BY pc.category_id`).all(...b.params) as { cid: number; n: number }[];
      const byCategory = new Map(per.map((r) => [r.cid, r.n]));
      const values = children.map((c): FacetValue => ({
        value: c.slug,
        label: c.name,
        count: descendantIds(env.rows, c.id).reduce((sum, id) => sum + (byCategory.get(id) ?? 0), 0),
      }));
      return { ...common, id: f.id, key: 'sub', kind: 'category', widget: f.widget === 'select' ? 'select' : 'checkbox', values };
    }
    case 'attribute': {
      const attr = f.attribute;
      if (!attr || env.catParams.length === 0) return null;
      const stat = env.stats.get(attr.id);
      const minProducts = f.config.minProducts ?? DEFAULT_MIN_PRODUCTS;
      const maxValues = f.config.maxValues ?? DEFAULT_MAX_VALUES;
      const key = `a${attr.id}`;
      const b = buildScope(env.base, String(attr.id));

      if (f.widget === 'range' && attr.type === 'number') {
        if (!stat || stat.numericProducts < minProducts) return null;
        const r = db
          .prepare(
            `SELECT MIN(pa.value_num) AS lo, MAX(pa.value_num) AS hi FROM product_attributes pa
             WHERE pa.attribute_id = ? AND pa.value_num IS NOT NULL AND pa.product_id IN (SELECT p.id FROM products p ${b.joins} WHERE ${b.where})`,
          )
          .get(attr.id, ...b.params) as { lo: number | null; hi: number | null };
        return { ...common, id: attr.id, key, kind: 'attribute', widget: 'range', unit: attr.unit, values: [], range: r.lo === null || r.hi === null ? null : { min: r.lo, max: r.hi } };
      }

      if (!stat || stat.products < minProducts || stat.values > maxValues) return null;
      // Одним запросом: все значения характеристики в категории (чтобы показать и нулевые) и их счётчики под текущий выбор.
      const found = db
        .prepare(
          `WITH scoped AS (SELECT p.id FROM products p ${b.joins} WHERE ${b.where})
           SELECT pa.value AS value, COUNT(DISTINCT CASE WHEN pa.product_id IN (SELECT id FROM scoped) THEN pa.product_id END) AS n
           FROM product_attributes pa JOIN products p ON p.id = pa.product_id
           WHERE pa.attribute_id = ? AND ${env.visible} ${env.catWhere}
           GROUP BY pa.value`,
        )
        .all(...b.params, attr.id, ...env.catParams) as { value: string; n: number }[];
      const values = found.map((r): FacetValue => ({ value: r.value, count: r.n })).sort((x, y) => collator.compare(x.value, y.value) || (x.value < y.value ? -1 : 1));
      return { ...common, id: attr.id, key, kind: 'attribute', widget: f.widget === 'select' ? 'select' : 'checkbox', unit: attr.unit, values };
    }
  }
}
