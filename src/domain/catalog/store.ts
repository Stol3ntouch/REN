/*
 * Чтение каталога для витрины (read-model). SQL здесь, а не в server/db/repositories,
 * потому что зона T04 не включает репозитории; запросы только параметризованные.
 */
import type { Db } from '@/server/db/connection';
import { ensureFold } from '@/server/db/fold';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';
import { parseVariants } from '@/server/db/repositories/images';
import { visibleProductSql } from '@/server/db/repositories/products';
import { listCategoryRows } from './category-rows';
import { toCatalogImage } from './images';
import { getPopularitySql } from './popularity';
import type { CatalogImage, FacetContext, ProductCard, SortKey } from './types';

export { ensureFold };

type SqlValue = string | number | null;

/** Цена к оплате: скидочная, если она действительно ниже обычной. */
export const EFFECTIVE_PRICE = `(CASE WHEN p.discount_price_kopecks IS NOT NULL AND p.discount_price_kopecks < p.price_kopecks THEN p.discount_price_kopecks ELSE p.price_kopecks END)`;

/** id категории и всех её потомков. */
export function descendantIds(rows: CategoryRow[], rootId: number): number[] {
  const byParent = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parentId !== null) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r.id]);
  }
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const id = stack.pop() as number;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return out;
}

export function categoryScope(db: Db, slug: string): { category: CategoryRow; ids: number[] } | null {
  const category = categoriesRepo.findVisibleBySlug(db, slug);
  if (!category) return null;
  return { category, ids: descendantIds(listCategoryRows(db), category.id) };
}

export type Scope = FacetContext & {
  categoryIds?: number[];
  /** Выбранные подкатегории вместе с потомками (уже разрешены из slug; undefined — фильтр не задан). */
  subCategoryIds?: number[];
  /** Выражение MATCH уже собрано (null — текста нет). */
  match: string | null;
};

type Built = { joins: string; where: string; params: SqlValue[] };

const SCORE_JOIN = `JOIN (SELECT rowid AS id, bm25(product_search, 10.0, 6.0, 8.0) AS score FROM product_search WHERE product_search MATCH ?) m ON m.id = p.id`;

/**
 * Подкатегории из адреса (slug) → id вместе с потомками. Берутся только категории внутри текущей (но не она сама);
 * неизвестные slug игнорируются. undefined — фильтр по подкатегориям не задан или не применим.
 */
export function resolveSubcategories(db: Db, categoryIds: number[] | undefined, slugs: readonly string[] | undefined): number[] | undefined {
  if (!categoryIds || !slugs || slugs.length === 0) return undefined;
  const rows = listCategoryRows(db);
  const inside = new Set(categoryIds);
  const wanted = new Set(slugs);
  const out = new Set<number>();
  for (const r of rows) {
    if (!wanted.has(r.slug) || !inside.has(r.id) || r.id === categoryIds[0]) continue;
    for (const id of descendantIds(rows, r.id)) out.add(id);
  }
  return out.size > 0 ? [...out] : undefined;
}

/**
 * Условия отбора. omit — не применять фильтр этой группы (для счётчиков фасета): id характеристики (строкой),
 * либо 'price' | 'stock' | 'brand' | 'sub'.
 */
export function buildScope(s: Scope, omitAttr?: string): Built {
  const joins: string[] = [];
  const params: SqlValue[] = [];
  const where: string[] = [visibleProductSql('p')];

  if (s.match !== null) {
    joins.push(SCORE_JOIN);
    params.push(s.match);
  }
  if (s.categoryIds) {
    where.push('p.category_id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(s.categoryIds));
  }
  if (s.subCategoryIds && omitAttr !== 'sub') {
    where.push('p.category_id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(s.subCategoryIds));
  }
  if (s.brands && s.brands.length > 0 && omitAttr !== 'brand') {
    where.push('p.brand_id IN (SELECT id FROM brands WHERE slug IN (SELECT value FROM json_each(?)))');
    params.push(JSON.stringify(s.brands));
  }
  for (const [attrId, range] of Object.entries(s.ranges ?? {})) {
    if (attrId === omitAttr || (range.min === undefined && range.max === undefined)) continue;
    where.push(
      'EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id AND pa.attribute_id = ? AND pa.value_num >= ? AND pa.value_num <= ?)',
    );
    params.push(Number(attrId), range.min ?? -1e15, range.max ?? 1e15);
  }
  for (const [attrId, values] of Object.entries(s.filters)) {
    if (attrId === omitAttr || values.length === 0) continue;
    where.push(
      'EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id AND pa.attribute_id = ? AND pa.value IN (SELECT value FROM json_each(?)))',
    );
    params.push(Number(attrId), JSON.stringify(values));
  }
  if (s.priceMin !== undefined && omitAttr !== 'price') {
    where.push(`${EFFECTIVE_PRICE} >= ?`);
    params.push(s.priceMin);
  }
  if (s.priceMax !== undefined && omitAttr !== 'price') {
    where.push(`${EFFECTIVE_PRICE} <= ?`);
    params.push(s.priceMax);
  }
  if (s.inStockOnly && omitAttr !== 'stock') where.push('p.in_stock = 1');
  return { joins: joins.join(' '), where: where.join(' AND '), params };
}

export function countProducts(db: Db, scope: Scope): number {
  const b = buildScope(scope);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM products p ${b.joins} WHERE ${b.where}`).get(...b.params) as { n: number };
  return row.n;
}

export type CardRow = {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  price_kopecks: number;
  discount_price_kopecks: number | null;
  in_stock: number;
  img_path: string | null;
  img_variants: string | null;
  img_url: string | null;
  img_alt: string | null;
};

export const CARD_COLUMNS = `p.id, p.slug, p.name, p.sku, p.price_kopecks, p.discount_price_kopecks, p.in_stock,
  pi.path AS img_path, pi.variants AS img_variants, pi.url_source AS img_url, pi.alt AS img_alt`;
export const CARD_JOIN = `LEFT JOIN product_images pi ON pi.id = (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1)`;

/** Разбор JSON вариантов фото — одна реализация в репозитории images; реэкспорт для прежних импортов. */
export { parseVariants };

export function unitPrice(price: number, discount: number | null): { unitKopecks: number; originalKopecks?: number } {
  return discount !== null && discount < price ? { unitKopecks: discount, originalKopecks: price } : { unitKopecks: price };
}

export function mapCard(r: CardRow): ProductCard {
  let image: CatalogImage | null = null;
  if (r.img_url !== null) {
    image = toCatalogImage({ path: r.img_path, variants: parseVariants(r.img_variants), urlSource: r.img_url, alt: r.img_alt }, 'card', r.name);
  }
  return { id: r.id, slug: r.slug, name: r.name, sku: r.sku, ...unitPrice(r.price_kopecks, r.discount_price_kopecks), inStock: r.in_stock === 1, image };
}

function orderBy(db: Db, sort: SortKey, hasText: boolean): { join: string; order: string } {
  ensureFold(db);
  const byName = 'rts_fold(p.name), p.name, p.id';
  switch (sort) {
    case 'price_asc':
      return { join: '', order: `${EFFECTIVE_PRICE} ASC, ${byName}` };
    case 'price_desc':
      return { join: '', order: `${EFFECTIVE_PRICE} DESC, ${byName}` };
    case 'popular': {
      const pop = getPopularitySql(db);
      // без заказов (источник не подключён) — алфавит
      if (!pop) return { join: '', order: byName };
      return { join: `LEFT JOIN (${pop}) pop ON pop.id = p.id`, order: `COALESCE(pop.units, 0) DESC, ${byName}` };
    }
    case 'relevance':
      return { join: '', order: hasText ? `m.score ASC, ${byName}` : byName };
    default:
      return { join: '', order: byName };
  }
}

export function listCards(db: Db, scope: Scope, sort: SortKey, limit: number, offset: number): ProductCard[] {
  const b = buildScope(scope);
  const o = orderBy(db, sort, scope.match !== null);
  const rows = db
    .prepare(`SELECT ${CARD_COLUMNS} FROM products p ${b.joins} ${o.join} ${CARD_JOIN} WHERE ${b.where} ORDER BY ${o.order} LIMIT ? OFFSET ?`)
    .all(...b.params, limit, offset) as CardRow[];
  return rows.map(mapCard);
}
