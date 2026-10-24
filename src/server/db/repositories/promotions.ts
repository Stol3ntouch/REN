import type { Db } from '../connection';
import { makeContentRepo } from './content-base';

export type DiscountType = 'percent' | 'fixed' | 'none';

export type PromotionRow = {
  id: number;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  summary: string | null;
  body: string;
  /** Условия акции — текст для покупателя. */
  conditions: string | null;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  promoCode: string | null;
  startsAt: number | null;
  endsAt: number | null;
  published: boolean;
  sort: number;
  discountType: DiscountType;
  /** percent: 1..99; fixed: копейки; none: 0. */
  discountValue: number;
  minSubtotalKopecks: number;
  maxDiscountKopecks: number | null;
  priority: number;
  createdAt: number;
  updatedAt: number;
};
export type PromotionWrite = Partial<Omit<PromotionRow, 'id' | 'updatedAt'>>;

const base = makeContentRepo<PromotionRow, PromotionWrite>({
  table: 'promotions',
  columns: [
    'slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'summary', 'body', 'conditions', 'imagePath', 'imageVariants', 'imageAlt',
    'promoCode', 'startsAt', 'endsAt', 'published', 'sort', 'discountType', 'discountValue', 'minSubtotalKopecks', 'maxDiscountKopecks',
    'priority', 'createdAt',
  ],
  booleans: ['published'],
  order: 'sort, id DESC',
});

export type PromotionTargets = { productIds: number[]; categoryIds: number[] };

export const promotionsRepo = {
  ...base,
  /** Акции, меняющие цену, действующие в момент now (опубликованы, внутри периода, тип скидки не «none»). */
  listPriced(db: Db, now: number): PromotionRow[] {
    return base.list(db, "published = 1 AND discount_type <> 'none' AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)", [now, now]);
  },
  /** Цели сразу для набора акций: id акции → товары и категории. */
  targetsFor(db: Db, ids: number[]): Map<number, PromotionTargets> {
    const out = new Map<number, PromotionTargets>(ids.map((id) => [id, { productIds: [], categoryIds: [] }]));
    if (ids.length === 0) return out;
    const marks = ids.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT promotion_id AS pid, product_id AS id FROM promotion_products WHERE promotion_id IN (${marks})`).all(...ids) as { pid: number; id: number }[]) {
      out.get(r.pid)?.productIds.push(r.id);
    }
    for (const r of db.prepare(`SELECT promotion_id AS pid, category_id AS id FROM promotion_categories WHERE promotion_id IN (${marks})`).all(...ids) as { pid: number; id: number }[]) {
      out.get(r.pid)?.categoryIds.push(r.id);
    }
    return out;
  },
  /** Дерево категорий: id → родитель (для учёта подкатегорий). */
  categoryParents(db: Db): Map<number, number | null> {
    const rows = db.prepare('SELECT id, parent_id FROM categories').all() as { id: number; parent_id: number | null }[];
    return new Map(rows.map((r) => [r.id, r.parent_id]));
  },
  /** Категории товаров (id → category_id) для набора товаров. */
  productCategories(db: Db, ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    if (ids.length === 0) return out;
    for (const r of db.prepare(`SELECT id, category_id FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number; category_id: number }[]) {
      out.set(r.id, r.category_id);
    }
    return out;
  },
  /** Товары, участвующие в акции (прямые и из категорий с подкатегориями), опубликованные, страницами. */
  participatingProducts(db: Db, t: PromotionTargets, limit: number, offset: number): { id: number; name: string; slug: string; priceKopecks: number; discountPriceKopecks: number | null }[] {
    const parts: string[] = [];
    const params: number[] = [];
    if (t.productIds.length > 0) {
      parts.push(`p.id IN (${t.productIds.map(() => '?').join(',')})`);
      params.push(...t.productIds);
    }
    if (t.categoryIds.length > 0) {
      parts.push('p.category_id IN (SELECT id FROM sub)');
    }
    if (parts.length === 0) return [];
    const cte = t.categoryIds.length > 0
      ? `WITH RECURSIVE sub(id) AS (SELECT id FROM categories WHERE id IN (${t.categoryIds.map(() => '?').join(',')}) UNION SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id)`
      : '';
    // Параметры: сначала категории CTE, затем условия WHERE в порядке parts.
    const sqlParams = [...t.categoryIds, ...params];
    return (
      db
        .prepare(
          `${cte} SELECT p.id, p.name, p.slug, p.price_kopecks, p.discount_price_kopecks FROM products p
           WHERE p.published = 1 AND p.hidden_by_admin = 0 AND (${parts.join(' OR ')}) ORDER BY p.name, p.id LIMIT ? OFFSET ?`,
        )
        .all(...sqlParams, limit, offset) as { id: number; name: string; slug: string; price_kopecks: number; discount_price_kopecks: number | null }[]
    ).map((r) => ({ id: r.id, name: r.name, slug: r.slug, priceKopecks: r.price_kopecks, discountPriceKopecks: r.discount_price_kopecks }));
  },
  targets(db: Db, id: number): PromotionTargets {
    const productIds = (db.prepare('SELECT product_id AS id FROM promotion_products WHERE promotion_id = ? ORDER BY product_id').all(id) as { id: number }[]).map((r) => r.id);
    const categoryIds = (db.prepare('SELECT category_id AS id FROM promotion_categories WHERE promotion_id = ? ORDER BY category_id').all(id) as { id: number }[]).map((r) => r.id);
    return { productIds, categoryIds };
  },
  replaceTargets(db: Db, id: number, t: PromotionTargets): void {
    db.prepare('DELETE FROM promotion_products WHERE promotion_id = ?').run(id);
    db.prepare('DELETE FROM promotion_categories WHERE promotion_id = ?').run(id);
    const p = db.prepare('INSERT INTO promotion_products (promotion_id, product_id) VALUES (?, ?)');
    for (const productId of t.productIds) p.run(id, productId);
    const c = db.prepare('INSERT INTO promotion_categories (promotion_id, category_id) VALUES (?, ?)');
    for (const categoryId of t.categoryIds) c.run(id, categoryId);
  },
  /** Товары для выбора в форме: поиск по названию и артикулу, только существующие. */
  searchProducts(db: Db, q: string, limit = 20): { id: number; name: string; sku: string | null; priceKopecks: number }[] {
    const needle = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (
      db
        .prepare("SELECT id, name, sku, price_kopecks FROM products WHERE name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?")
        .all(needle, needle, limit) as { id: number; name: string; sku: string | null; price_kopecks: number }[]
    ).map((r) => ({ id: r.id, name: r.name, sku: r.sku, priceKopecks: r.price_kopecks }));
  },
  productsByIds(db: Db, ids: number[]): { id: number; name: string; sku: string | null; priceKopecks: number; categoryId: number }[] {
    if (ids.length === 0) return [];
    return (
      db
        .prepare(`SELECT id, name, sku, price_kopecks, category_id FROM products WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`)
        .all(...ids) as { id: number; name: string; sku: string | null; price_kopecks: number; category_id: number }[]
    ).map((r) => ({ id: r.id, name: r.name, sku: r.sku, priceKopecks: r.price_kopecks, categoryId: r.category_id }));
  },
  /** Самая низкая обычная цена среди товаров категорий (с подкатегориями) и отдельных товаров; null — нет товаров. */
  minPrice(db: Db, t: PromotionTargets): number | null {
    let min: number | null = null;
    const take = (v: number | null | undefined) => {
      if (typeof v === 'number' && (min === null || v < min)) min = v;
    };
    if (t.productIds.length > 0) {
      take(
        (db.prepare(`SELECT MIN(price_kopecks) AS m FROM products WHERE id IN (${t.productIds.map(() => '?').join(',')})`).get(...t.productIds) as { m: number | null }).m,
      );
    }
    if (t.categoryIds.length > 0) {
      const marks = t.categoryIds.map(() => '?').join(',');
      take(
        (
          db
            .prepare(
              `WITH RECURSIVE sub(id) AS (SELECT id FROM categories WHERE id IN (${marks}) UNION SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id)
               SELECT MIN(price_kopecks) AS m FROM products WHERE category_id IN (SELECT id FROM sub)`,
            )
            .get(...t.categoryIds) as { m: number | null }
        ).m,
      );
    }
    return min;
  },
  /** Все товары, на которые распространяется акция: прямые и из категорий с подкатегориями. */
  expandProductIds(db: Db, t: PromotionTargets): Set<number> {
    const out = new Set<number>(t.productIds);
    if (t.categoryIds.length > 0) {
      const marks = t.categoryIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (SELECT id FROM categories WHERE id IN (${marks}) UNION SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id)
           SELECT id FROM products WHERE category_id IN (SELECT id FROM sub)`,
        )
        .all(...t.categoryIds) as { id: number }[];
      for (const r of rows) out.add(r.id);
    }
    return out;
  },
  /** Категории для выбора в форме: название с цепочкой родителей («Сад › Газонокосилки»). */
  categoryOptions(db: Db): { id: number; label: string }[] {
    const rows = db.prepare('SELECT id, parent_id, name FROM categories').all() as { id: number; parent_id: number | null; name: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const label = (id: number, depth = 0): string => {
      const r = byId.get(id);
      if (!r) return '';
      return r.parent_id !== null && depth < 6 ? `${label(r.parent_id, depth + 1)} › ${r.name}` : r.name;
    };
    return rows.map((r) => ({ id: r.id, label: label(r.id) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  },
  existingProductIds(db: Db, ids: number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = db.prepare(`SELECT id FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  },
  existingCategoryIds(db: Db, ids: number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = db.prepare(`SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  },
  categoryNames(db: Db, ids: number[]): { id: number; name: string }[] {
    if (ids.length === 0) return [];
    return db.prepare(`SELECT id, name FROM categories WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids) as { id: number; name: string }[];
  },
};
