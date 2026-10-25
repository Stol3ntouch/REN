import type { Db } from '../connection';
import type { Availability } from './stock';

/** Товар целиком, как его видит карточка в админке. Закупочная цена здесь есть всегда — отсекает сервис при отсутствии права. */
export type ProductFull = {
  id: number;
  source: string;
  externalId: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: number;
  categoryName: string;
  brandId: number | null;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  oldPriceKopecks: number | null;
  purchasePriceKopecks: number | null;
  stockQty: number;
  reservedQty: number;
  stockTracked: boolean;
  availability: Availability;
  availabilityManual: boolean;
  inStock: boolean;
  published: boolean;
  hiddenByAdmin: boolean;
  featured: boolean;
  isNew: boolean;
  isPromo: boolean;
  canonicalUrl: string | null;
  indexable: boolean;
  createdAt: string | null;
  createdBy: number | null;
  updatedAt: string;
  lockedFields: string[];
  seoTitle: string | null;
  seoDescription: string | null;
};

type Raw = Record<string, string | number | null>;

const SELECT = `SELECT p.id, p.source, p.external_id, p.sku, p.barcode, p.name, p.slug, p.short_description, p.description, p.category_id, c.name AS category_name,
  p.brand_id, p.price_kopecks, p.discount_price_kopecks, p.old_price_kopecks, p.purchase_price_kopecks, p.stock_qty, p.reserved_qty, p.stock_tracked,
  p.availability, p.availability_manual, p.in_stock, p.published, p.hidden_by_admin, p.featured, p.is_new, p.is_promo, p.canonical_url, p.indexable,
  p.created_at, p.created_by, p.updated_at, p.locked_fields, s.seo_title, s.seo_description
  FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN product_seo s ON s.product_id = p.id`;

function locked(json: unknown): string[] {
  try {
    const v: unknown = JSON.parse(String(json));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function map(r: Raw): ProductFull {
  const num = (k: string) => (r[k] === null ? null : Number(r[k]));
  const str = (k: string) => (r[k] === null ? null : String(r[k]));
  return {
    id: Number(r.id),
    source: String(r.source),
    externalId: String(r.external_id),
    sku: str('sku'),
    barcode: str('barcode'),
    name: String(r.name),
    slug: String(r.slug),
    shortDescription: str('short_description'),
    description: str('description'),
    categoryId: Number(r.category_id),
    categoryName: String(r.category_name),
    brandId: num('brand_id'),
    priceKopecks: Number(r.price_kopecks),
    discountPriceKopecks: num('discount_price_kopecks'),
    oldPriceKopecks: num('old_price_kopecks'),
    purchasePriceKopecks: num('purchase_price_kopecks'),
    stockQty: Number(r.stock_qty),
    reservedQty: Number(r.reserved_qty),
    stockTracked: r.stock_tracked === 1,
    availability: String(r.availability) as Availability,
    availabilityManual: r.availability_manual === 1,
    inStock: r.in_stock === 1,
    published: r.published === 1,
    hiddenByAdmin: r.hidden_by_admin === 1,
    featured: r.featured === 1,
    isNew: r.is_new === 1,
    isPromo: r.is_promo === 1,
    canonicalUrl: str('canonical_url'),
    indexable: r.indexable === 1,
    createdAt: str('created_at'),
    createdBy: num('created_by'),
    updatedAt: String(r.updated_at),
    lockedFields: locked(r.locked_fields),
    seoTitle: str('seo_title'),
    seoDescription: str('seo_description'),
  };
}

/** Поля, которые карточка пишет в products; ключ → столбец. Остаток и резерв здесь нет: их меняет только сервис stock. */
const COLUMNS = {
  sku: 'sku',
  barcode: 'barcode',
  name: 'name',
  slug: 'slug',
  shortDescription: 'short_description',
  description: 'description',
  categoryId: 'category_id',
  brandId: 'brand_id',
  priceKopecks: 'price_kopecks',
  discountPriceKopecks: 'discount_price_kopecks',
  oldPriceKopecks: 'old_price_kopecks',
  purchasePriceKopecks: 'purchase_price_kopecks',
  published: 'published',
  hiddenByAdmin: 'hidden_by_admin',
  featured: 'featured',
  isNew: 'is_new',
  isPromo: 'is_promo',
  canonicalUrl: 'canonical_url',
  indexable: 'indexable',
} as const;

export type ProductColumns = {
  -readonly [K in keyof typeof COLUMNS]: K extends 'published' | 'hiddenByAdmin' | 'featured' | 'isNew' | 'isPromo' | 'indexable' ? boolean : K extends `${string}Kopecks` | 'categoryId' | 'brandId' ? number | null : string | null;
};

const BOOLEANS = new Set<string>(['published', 'hiddenByAdmin', 'featured', 'isNew', 'isPromo', 'indexable']);

export type NewManualProduct = ProductColumns & { externalId: string; createdBy: number | null; now: string };

export type ProductDependencies = { orders: number; favorites: number; carts: number; compare: number; reviews: number };

export const productsAdminRepo = {
  findById(db: Db, id: number): ProductFull | undefined {
    const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Raw | undefined;
    return r && map(r);
  },

  /** id товара, занявшего slug (кроме exceptId). */
  slugOwner(db: Db, slug: string, exceptId?: number): number | null {
    const r = db.prepare('SELECT id FROM products WHERE slug = ? AND id <> ?').get(slug, exceptId ?? -1) as { id: number } | undefined;
    return r?.id ?? null;
  },

  allSlugs(db: Db): Set<string> {
    return new Set((db.prepare('SELECT slug FROM products').all() as { slug: string }[]).map((r) => r.slug));
  },

  /** Другой товар того же источника с таким артикулом. */
  skuOwner(db: Db, source: string, sku: string, exceptId?: number): number | null {
    const r = db.prepare('SELECT id FROM products WHERE source = ? AND sku = ? AND id <> ? LIMIT 1').get(source, sku, exceptId ?? -1) as { id: number } | undefined;
    return r?.id ?? null;
  },

  /** Создание вручную: источник manual, остаток 0 и учёт выключен (остаток задаётся отдельно через сервис stock). */
  insertManual(db: Db, p: NewManualProduct): number {
    const r = db
      .prepare(
        `INSERT INTO products (source, external_id, sku, barcode, name, slug, short_description, description, category_id, brand_id, price_kopecks, discount_price_kopecks,
           old_price_kopecks, purchase_price_kopecks, published, hidden_by_admin, featured, is_new, is_promo, canonical_url, indexable, in_stock, availability,
           first_seen_at, created_at, created_by, updated_at)
         VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'in_stock', ?, ?, ?, ?)`,
      )
      .run(
        p.externalId,
        p.sku,
        p.barcode,
        p.name,
        p.slug,
        p.shortDescription,
        p.description,
        p.categoryId,
        p.brandId,
        p.priceKopecks,
        p.discountPriceKopecks,
        p.oldPriceKopecks,
        p.purchasePriceKopecks,
        p.published ? 1 : 0,
        p.hiddenByAdmin ? 1 : 0,
        p.featured ? 1 : 0,
        p.isNew ? 1 : 0,
        p.isPromo ? 1 : 0,
        p.canonicalUrl,
        p.indexable ? 1 : 0,
        p.now,
        p.now,
        p.createdBy,
        p.now,
      );
    return Number(r.lastInsertRowid);
  },

  update(db: Db, id: number, patch: Partial<ProductColumns>, now: string): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof typeof COLUMNS, string | number | boolean | null][]) {
      if (!(key in COLUMNS)) continue;
      sets.push(`${COLUMNS[key]} = ?`);
      values.push(BOOLEANS.has(key) ? (value ? 1 : 0) : (value as string | number | null));
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values, now, id);
  },

  setLocked(db: Db, id: number, fields: string[]): void {
    db.prepare('UPDATE products SET locked_fields = ? WHERE id = ?').run(JSON.stringify(fields), id);
  },

  upsertSeo(db: Db, id: number, seo: { title: string | null; description: string | null }, now: number): void {
    db.prepare(
      'INSERT INTO product_seo (product_id, seo_title, seo_description, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = excluded.updated_at',
    ).run(id, seo.title, seo.description, now);
  },

  /** Удаление; связи (категории, характеристики, фото, остатки, избранное, корзины, сравнение, отзывы) уходят каскадом. */
  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  },

  dependencies(db: Db, id: number): ProductDependencies {
    const n = (sql: string) => Number((db.prepare(sql).get(id) as { n: number }).n);
    return {
      orders: n('SELECT COUNT(DISTINCT order_id) AS n FROM order_items WHERE product_id = ?'),
      favorites: n('SELECT COUNT(*) AS n FROM favorites WHERE product_id = ?'),
      carts: n('SELECT COUNT(*) AS n FROM cart_items WHERE product_id = ?'),
      compare: n('SELECT COUNT(*) AS n FROM compare_items WHERE product_id = ?'),
      reviews: n('SELECT COUNT(*) AS n FROM reviews WHERE product_id = ?'),
    };
  },
};
