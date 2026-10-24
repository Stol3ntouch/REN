import type { Db } from '../connection';
import { ensureFold, likeContains } from '../fold';

export type BrandRow = {
  id: number;
  name: string;
  slug: string;
  logoPath: string | null;
  logoVariants: string | null;
  description: string | null;
  siteUrl: string | null;
  published: boolean;
  archived: boolean;
  sort: number;
  seoTitle: string | null;
  seoDescription: string | null;
  source: string;
  externalId: string | null;
};

export type BrandListRow = BrandRow & { productCount: number };

type Raw = {
  id: number;
  name: string;
  slug: string;
  logo_path: string | null;
  logo_variants: string | null;
  description: string | null;
  site_url: string | null;
  published: number;
  archived: number;
  sort: number;
  seo_title: string | null;
  seo_description: string | null;
  source: string;
  external_id: string | null;
};

const COLUMNS = 'b.id, b.name, b.slug, b.logo_path, b.logo_variants, b.description, b.site_url, b.published, b.archived, b.sort, b.seo_title, b.seo_description, b.source, b.external_id';

function map(r: Raw): BrandRow {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    logoPath: r.logo_path,
    logoVariants: r.logo_variants,
    description: r.description,
    siteUrl: r.site_url,
    published: r.published === 1,
    archived: r.archived === 1,
    sort: r.sort,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    source: r.source,
    externalId: r.external_id,
  };
}

export type BrandFields = {
  name: string;
  slug: string;
  description: string | null;
  siteUrl: string | null;
  published: boolean;
  sort: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type NewBrand = BrandFields & { logoPath?: string | null; logoVariants?: string | null; source?: string; externalId?: string | null };

export type BrandListQuery = {
  q?: string;
  /** 'published' | 'hidden' | 'archived' | 'active' (не в архиве). По умолчанию — все, кроме архивных. */
  status?: 'published' | 'hidden' | 'archived' | 'active' | 'all';
  sort: 'name' | 'sort' | 'products' | 'created';
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
};

const SORTS: Record<BrandListQuery['sort'], string> = {
  name: 'rts_fold(b.name)',
  sort: 'b.sort',
  products: 'product_count',
  created: 'b.id',
};

export type BrandProductRow = { id: number; name: string; sku: string | null; slug: string; published: boolean; inStock: boolean };

export const brandsRepo = {
  list(db: Db, q: BrandListQuery): { rows: BrandListRow[]; total: number } {
    ensureFold(db);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.q) {
      where.push(String.raw`(rts_fold(b.name) LIKE ? ESCAPE '\' OR b.slug LIKE ? ESCAPE '\')`);
      const like = likeContains(q.q);
      params.push(like, like);
    }
    const status = q.status ?? 'active';
    if (status === 'published') where.push('b.published = 1 AND b.archived = 0');
    else if (status === 'hidden') where.push('b.published = 0 AND b.archived = 0');
    else if (status === 'archived') where.push('b.archived = 1');
    else if (status !== 'all') where.push('b.archived = 0');
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM brands b ${w}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT ${COLUMNS}, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS product_count
         FROM brands b ${w}
         ORDER BY ${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, b.sort, rts_fold(b.name), b.id
         LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as (Raw & { product_count: number })[];
    return { total, rows: rows.map((r) => ({ ...map(r), productCount: r.product_count })) };
  },

  /** Все бренды (для выпадающих списков), без архивных, если not includeArchived. */
  listAll(db: Db, opts: { includeArchived?: boolean } = {}): BrandRow[] {
    ensureFold(db);
    const rows = db.prepare(`SELECT ${COLUMNS} FROM brands b ${opts.includeArchived ? '' : 'WHERE b.archived = 0'} ORDER BY b.sort, rts_fold(b.name), b.id`).all() as Raw[];
    return rows.map(map);
  },

  findById(db: Db, id: number): BrandRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM brands b WHERE b.id = ?`).get(id) as Raw | undefined;
    return r && map(r);
  },

  findBySlug(db: Db, slug: string): BrandRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM brands b WHERE b.slug = ?`).get(slug) as Raw | undefined;
    return r && map(r);
  },

  findByExternalId(db: Db, source: string, externalId: string): BrandRow | undefined {
    const r = db.prepare(`SELECT ${COLUMNS} FROM brands b WHERE b.source = ? AND b.external_id = ?`).get(source, externalId) as Raw | undefined;
    return r && map(r);
  },

  /** Бренд с таким названием без учёта регистра (для проверки дубля и привязки из импорта). */
  findByName(db: Db, name: string): BrandRow | undefined {
    ensureFold(db);
    const r = db.prepare(`SELECT ${COLUMNS} FROM brands b WHERE rts_fold(b.name) = rts_fold(?) ORDER BY b.id LIMIT 1`).get(name) as Raw | undefined;
    return r && map(r);
  },

  allSlugs(db: Db): Set<string> {
    return new Set((db.prepare('SELECT slug FROM brands').all() as { slug: string }[]).map((r) => r.slug));
  },

  insert(db: Db, b: NewBrand, now: string): number {
    const r = db
      .prepare(
        `INSERT INTO brands (name, slug, logo_path, logo_variants, description, site_url, published, sort, seo_title, seo_description, source, external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        b.name,
        b.slug,
        b.logoPath ?? null,
        b.logoVariants ?? null,
        b.description,
        b.siteUrl,
        b.published ? 1 : 0,
        b.sort,
        b.seoTitle,
        b.seoDescription,
        b.source ?? 'manual',
        b.externalId ?? null,
        now,
        now,
      ) as { id: number };
    return r.id;
  },

  update(db: Db, id: number, b: BrandFields & { logoPath?: string | null; logoVariants?: string | null }, now: string): void {
    const logo = b.logoPath !== undefined ? ', logo_path = ?, logo_variants = ?' : '';
    const params: (string | number | null)[] = [b.name, b.slug, b.description, b.siteUrl, b.published ? 1 : 0, b.sort, b.seoTitle, b.seoDescription, now];
    if (b.logoPath !== undefined) params.push(b.logoPath, b.logoVariants ?? null);
    db.prepare(
      `UPDATE brands SET name = ?, slug = ?, description = ?, site_url = ?, published = ?, sort = ?, seo_title = ?, seo_description = ?, updated_at = ?${logo} WHERE id = ?`,
    ).run(...params, id);
  },

  setArchived(db: Db, id: number, archived: boolean, now: string): void {
    db.prepare('UPDATE brands SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  },

  setPublished(db: Db, id: number, published: boolean, now: string): void {
    db.prepare('UPDATE brands SET published = ?, updated_at = ? WHERE id = ?').run(published ? 1 : 0, now, id);
  },

  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM brands WHERE id = ?').run(id);
  },

  productCount(db: Db, id: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM products WHERE brand_id = ?').get(id) as { n: number }).n;
  },

  /** Товары бренда (админка: все, включая скрытые), постранично. */
  listProducts(db: Db, brandId: number, limit: number, offset: number): BrandProductRow[] {
    const rows = db
      .prepare('SELECT id, name, sku, slug, published, in_stock FROM products WHERE brand_id = ? ORDER BY name, id LIMIT ? OFFSET ?')
      .all(brandId, limit, offset) as { id: number; name: string; sku: string | null; slug: string; published: number; in_stock: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, slug: r.slug, published: r.published === 1, inStock: r.in_stock === 1 }));
  },

  /** Поиск товаров для привязки: по названию или артикулу, только не принадлежащие этому бренду. */
  searchProductsToAttach(db: Db, brandId: number, text: string, limit: number): (BrandProductRow & { brandName: string | null })[] {
    ensureFold(db);
    const like = likeContains(text);
    const rows = db
      .prepare(
        String.raw`SELECT p.id, p.name, p.sku, p.slug, p.published, p.in_stock, b.name AS brand_name
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
         WHERE (p.brand_id IS NULL OR p.brand_id <> ?) AND (rts_fold(p.name) LIKE ? ESCAPE '\' OR rts_fold(COALESCE(p.sku, '')) LIKE ? ESCAPE '\')
         ORDER BY p.name, p.id LIMIT ?`,
      )
      .all(brandId, like, like, limit) as { id: number; name: string; sku: string | null; slug: string; published: number; in_stock: number; brand_name: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, slug: r.slug, published: r.published === 1, inStock: r.in_stock === 1, brandName: r.brand_name }));
  },

  /** Привязывает товары к бренду (brandId = null — отвязывает). Возвращает число изменённых. */
  assignProducts(db: Db, brandId: number | null, productIds: number[]): number {
    const stmt = db.prepare('UPDATE products SET brand_id = ? WHERE id = ? AND (brand_id IS NOT ? )');
    let n = 0;
    for (const id of productIds) n += Number(stmt.run(brandId, id, brandId).changes);
    return n;
  },

  /** Переносит все товары одного бренда к другому (или снимает бренд). */
  moveProducts(db: Db, fromId: number, toId: number | null): number {
    return Number(db.prepare('UPDATE products SET brand_id = ? WHERE brand_id = ?').run(toId, fromId).changes);
  },

  setProductBrand(db: Db, productId: number, brandId: number | null): void {
    db.prepare('UPDATE products SET brand_id = ? WHERE id = ?').run(brandId, productId);
  },

  getProductBrandId(db: Db, productId: number): number | null | undefined {
    const r = db.prepare('SELECT brand_id FROM products WHERE id = ?').get(productId) as { brand_id: number | null } | undefined;
    return r?.brand_id;
  },
};
