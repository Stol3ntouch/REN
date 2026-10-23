import type { Db } from '../connection';

export type AdminProductRow = {
  id: number;
  name: string;
  sku: string | null;
  slug: string;
  description: string | null;
  categoryId: number;
  categoryName: string;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  inStock: boolean;
  published: boolean;
  featured: boolean;
  source: string;
  updatedAt: string;
  lockedFields: string[];
  seoTitle: string | null;
  seoDescription: string | null;
};

type Raw = {
  id: number;
  name: string;
  sku: string | null;
  slug: string;
  description: string | null;
  category_id: number;
  category_name: string;
  price_kopecks: number;
  discount_price_kopecks: number | null;
  in_stock: number;
  published: number;
  featured: number;
  source: string;
  updated_at: string;
  locked_fields: string;
  seo_title: string | null;
  seo_description: string | null;
};

const SELECT = `SELECT p.id, p.name, p.sku, p.slug, p.description, p.category_id, c.name AS category_name, p.price_kopecks,
  p.discount_price_kopecks, p.in_stock, p.published, p.featured, p.source, p.updated_at, p.locked_fields,
  s.seo_title, s.seo_description
  FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN product_seo s ON s.product_id = p.id`;

function locked(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const map = (r: Raw): AdminProductRow => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  slug: r.slug,
  description: r.description,
  categoryId: r.category_id,
  categoryName: r.category_name,
  priceKopecks: r.price_kopecks,
  discountPriceKopecks: r.discount_price_kopecks,
  inStock: r.in_stock === 1,
  published: r.published === 1,
  featured: r.featured === 1,
  source: r.source,
  updatedAt: r.updated_at,
  lockedFields: locked(r.locked_fields),
  seoTitle: r.seo_title,
  seoDescription: r.seo_description,
});

export type ProductListFilter = { q?: string; categoryId?: number; published?: boolean; inStock?: boolean; page?: number; pageSize?: number };

const folded = new WeakSet<Db>();
/** SQLite lower() знает только ASCII: для кириллицы регистрируем свою функцию на соединении. */
function ensureLc(db: Db): void {
  if (folded.has(db)) return;
  db.function('rts_lc', { deterministic: true }, (v) => (typeof v === 'string' ? v.toLowerCase() : v));
  folded.add(db);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const catalogAdminRepo = {
  findById(db: Db, id: number): AdminProductRow | null {
    const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Raw | undefined;
    return r ? map(r) : null;
  },

  list(db: Db, f: ProductListFilter = {}): { rows: AdminProductRow[]; total: number; page: number; pageSize: number } {
    ensureLc(db);
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.q) {
      const like = `%${escapeLike(f.q.toLowerCase())}%`;
      where.push("(rts_lc(p.name) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.sku, '')) LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    if (f.categoryId !== undefined) {
      where.push('p.category_id = ?');
      args.push(f.categoryId);
    }
    if (f.published !== undefined) {
      where.push('p.published = ?');
      args.push(f.published ? 1 : 0);
    }
    if (f.inStock !== undefined) {
      where.push('p.in_stock = ?');
      args.push(f.inStock ? 1 : 0);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM products p ${w}`).get(...args) as { n: number }).n);
    const rows = db.prepare(`${SELECT} ${w} ORDER BY p.id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as Raw[];
    return { rows: rows.map(map), total, page, pageSize };
  },

  categories(db: Db): { id: number; name: string }[] {
    return db.prepare('SELECT id, name FROM categories ORDER BY name').all() as { id: number; name: string }[];
  },

  /** Ручные правки полей, которые импорт не присылает или которые закрепляются. */
  updateFields(
    db: Db,
    id: number,
    patch: Partial<{ priceKopecks: number; discountPriceKopecks: number | null; published: boolean; featured: boolean; description: string | null }>,
    now: string,
  ): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const add = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      values.push(v);
    };
    if (patch.priceKopecks !== undefined) add('price_kopecks', patch.priceKopecks);
    if (patch.discountPriceKopecks !== undefined) add('discount_price_kopecks', patch.discountPriceKopecks);
    if (patch.published !== undefined) add('published', patch.published ? 1 : 0);
    if (patch.featured !== undefined) add('featured', patch.featured ? 1 : 0);
    if (patch.description !== undefined) add('description', patch.description);
    if (sets.length === 0) return;
    add('updated_at', now);
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  setLocked(db: Db, id: number, fields: string[]): void {
    db.prepare('UPDATE products SET locked_fields = ? WHERE id = ?').run(JSON.stringify(fields), id);
  },

  upsertSeo(db: Db, id: number, seo: { title: string | null; description: string | null }, now: number): void {
    db.prepare(
      'INSERT INTO product_seo (product_id, seo_title, seo_description, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = excluded.updated_at',
    ).run(id, seo.title, seo.description, now);
  },
};
