import { getDb, type Db } from '@/server/db/connection';
import { listCategoryRows } from './category-rows';
import { buildMatchQuery } from './fts';
import { buildScope, descendantIds, type Scope } from './store';
import { FACET_MAX_VALUES, FACET_MIN_PRODUCTS, type Facet, type FacetContext } from './types';

/**
 * Фильтры категории (вместе с подкатегориями) по реальным характеристикам товаров.
 * Правило: характеристика — фильтр, если она есть у ≥3 опубликованных товаров категории
 * и имеет ≤30 различных значений. Правило считается по всей категории, а не по текущей выдаче,
 * поэтому фильтры не пропадают при выборе значений.
 * Счётчик значения = сколько товаров будет в выдаче, если выбрать это значение при остальных
 * активных фильтрах (фильтр самой характеристики при её подсчёте не применяется).
 */
export async function getFacets(categoryId: number, ctx: FacetContext = { filters: {} }, opts: { db?: Db } = {}): Promise<Facet[]> {
  const db = opts.db ?? getDb();
  const categoryIds = descendantIds(listCategoryRows(db), categoryId);
  const idsJson = JSON.stringify(categoryIds);

  const eligible = db
    .prepare(
      `SELECT d.id AS id, d.name AS name, COUNT(DISTINCT p.id) AS products
       FROM product_attributes pa
       JOIN products p ON p.id = pa.product_id
       JOIN attribute_definitions d ON d.id = pa.attribute_id
       WHERE p.published = 1 AND p.category_id IN (SELECT value FROM json_each(?))
       GROUP BY d.id
       HAVING COUNT(DISTINCT p.id) >= ? AND COUNT(DISTINCT pa.value) <= ?
       ORDER BY products DESC, d.name, d.id`,
    )
    .all(idsJson, FACET_MIN_PRODUCTS, FACET_MAX_VALUES) as { id: number; name: string; products: number }[];

  const text = (ctx.text ?? '').trim();
  const match = text === '' ? null : buildMatchQuery(text);
  const base: Scope = { categoryIds, match, text: ctx.text, filters: ctx.filters, priceMin: ctx.priceMin, priceMax: ctx.priceMax, inStockOnly: ctx.inStockOnly };

  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const facets: Facet[] = [];
  for (const attr of eligible) {
    // Все значения характеристики в категории (чтобы показать и нулевые), затем счётчики под текущий выбор.
    const all = db
      .prepare(
        `SELECT DISTINCT pa.value AS value FROM product_attributes pa JOIN products p ON p.id = pa.product_id
         WHERE pa.attribute_id = ? AND p.published = 1 AND p.category_id IN (SELECT value FROM json_each(?))`,
      )
      .all(attr.id, idsJson) as { value: string }[];

    const b = buildScope(base, String(attr.id));
    const counted = db
      .prepare(
        `SELECT pa.value AS value, COUNT(DISTINCT p.id) AS n
         FROM products p ${b.joins}
         JOIN product_attributes pa ON pa.product_id = p.id AND pa.attribute_id = ?
         WHERE ${b.where}
         GROUP BY pa.value`,
      )
      // параметры JOIN-ов (MATCH) идут раньше параметра attribute_id, затем условия WHERE
      .all(...splitParams(b, attr.id)) as { value: string; n: number }[];
    const counts = new Map(counted.map((r) => [r.value, r.n]));

    const values = all.map((r) => ({ value: r.value, count: counts.get(r.value) ?? 0 })).sort((x, y) => collator.compare(x.value, y.value) || (x.value < y.value ? -1 : 1));
    facets.push({ id: attr.id, name: attr.name, values });
  }
  return facets;
}

/** Порядок параметров: сначала MATCH (если есть JOIN), затем attribute_id, затем параметры WHERE. */
function splitParams(b: { joins: string; params: (string | number | null)[] }, attributeId: number): (string | number | null)[] {
  if (b.joins === '') return [attributeId, ...b.params];
  const [match, ...rest] = b.params;
  return [match as string | number | null, attributeId, ...rest];
}
