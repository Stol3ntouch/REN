import type { Db } from '../connection';

export type ProductRow = {
  id: number;
  source: string;
  externalId: string;
  sku: string | null;
  name: string;
  slug: string;
  description: string | null;
  categoryId: number;
  /** external_id категории (для сравнения с файлом импорта). */
  categoryExternalId: string;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  inStock: boolean;
  published: boolean;
  featured: boolean;
  firstSeenAt: string;
  updatedAt: string;
  lockedFields: string[];
};

type Raw = {
  id: number;
  source: string;
  external_id: string;
  sku: string | null;
  name: string;
  slug: string;
  description: string | null;
  category_id: number;
  category_external_id: string;
  price_kopecks: number;
  discount_price_kopecks: number | null;
  in_stock: number;
  published: number;
  featured: number;
  first_seen_at: string;
  updated_at: string;
  locked_fields: string;
};

const SELECT = `SELECT p.id, p.source, p.external_id, p.sku, p.name, p.slug, p.description, p.category_id,
  c.external_id AS category_external_id, p.price_kopecks, p.discount_price_kopecks, p.in_stock, p.published,
  p.featured, p.first_seen_at, p.updated_at, p.locked_fields
  FROM products p JOIN categories c ON c.id = p.category_id`;

function parseLocked(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function map(r: Raw): ProductRow {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    sku: r.sku,
    name: r.name,
    slug: r.slug,
    description: r.description,
    categoryId: r.category_id,
    categoryExternalId: r.category_external_id,
    priceKopecks: r.price_kopecks,
    discountPriceKopecks: r.discount_price_kopecks,
    inStock: r.in_stock === 1,
    published: r.published === 1,
    featured: r.featured === 1,
    firstSeenAt: r.first_seen_at,
    updatedAt: r.updated_at,
    lockedFields: parseLocked(r.locked_fields),
  };
}

export type NewProduct = {
  source: string;
  externalId: string;
  sku: string | null;
  name: string;
  slug: string;
  description: string | null;
  categoryId: number;
  priceKopecks: number;
  inStock: boolean;
  now: string;
};

export type ProductPatch = Partial<{
  sku: string | null;
  name: string;
  description: string | null;
  categoryId: number;
  priceKopecks: number;
  inStock: boolean;
}>;

export const productsRepo = {
  findByExternalId(db: Db, source: string, externalId: string): ProductRow | undefined {
    const r = db.prepare(`${SELECT} WHERE p.source = ? AND p.external_id = ?`).get(source, externalId) as Raw | undefined;
    return r && map(r);
  },

  findBySlug(db: Db, slug: string): ProductRow | undefined {
    const r = db.prepare(`${SELECT} WHERE p.slug = ?`).get(slug) as Raw | undefined;
    return r && map(r);
  },

  allSlugs(db: Db): Set<string> {
    return new Set((db.prepare('SELECT slug FROM products').all() as { slug: string }[]).map((r) => r.slug));
  },

  count(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
  },

  insert(db: Db, p: NewProduct): number {
    const r = db
      .prepare(
        `INSERT INTO products (source, external_id, sku, name, slug, description, category_id, price_kopecks, in_stock, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.source, p.externalId, p.sku, p.name, p.slug, p.description, p.categoryId, p.priceKopecks, p.inStock ? 1 : 0, p.now, p.now);
    return Number(r.lastInsertRowid);
  },

  /** Обновляет только переданные поля и updated_at. slug, published, featured, discount импорт не трогает. */
  update(db: Db, id: number, patch: ProductPatch, now: string): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const add = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      values.push(v);
    };
    if (patch.sku !== undefined) add('sku', patch.sku);
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.categoryId !== undefined) add('category_id', patch.categoryId);
    if (patch.priceKopecks !== undefined) add('price_kopecks', patch.priceKopecks);
    if (patch.inStock !== undefined) add('in_stock', patch.inStock ? 1 : 0);
    if (sets.length === 0) return;
    add('updated_at', now);
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  /** Отмечает время изменения (например, после замены характеристик или фото). */
  touch(db: Db, id: number, now: string): void {
    db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now, id);
  },

  setLockedFields(db: Db, id: number, fields: string[]): void {
    db.prepare('UPDATE products SET locked_fields = ? WHERE id = ?').run(JSON.stringify(fields), id);
  },
};
