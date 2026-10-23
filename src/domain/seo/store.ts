import { visibleProductSql } from '@/server/db/repositories/products';
import { getDb, type Db } from '@/server/db/connection';

// SQL чтения для SEO лежит здесь по тому же исключению из правила 4, что и в domain/catalog/store.ts.

export type ProductSeo = { seoTitle: string | null; seoDescription: string | null };

/** Ручные SEO-поля товара (T10, таблица product_seo); нет строки — null. */
export function getProductSeo(productId: number, opts: { db?: Db } = {}): ProductSeo | null {
  const r = (opts.db ?? getDb())
    .prepare('SELECT seo_title, seo_description FROM product_seo WHERE product_id = ?')
    .get(productId) as { seo_title: string | null; seo_description: string | null } | undefined;
  return r ? { seoTitle: r.seo_title, seoDescription: r.seo_description } : null;
}

/** Опубликованные товары для sitemap: slug и время изменения (ISO-строка из products.updated_at). */
export function listPublishedProductStamps(db: Db): { slug: string; updatedAt: string }[] {
  return (db.prepare(`SELECT slug, updated_at FROM products p WHERE ${visibleProductSql('p')} ORDER BY p.id`).all() as { slug: string; updated_at: string }[]).map((r) => ({
    slug: r.slug,
    updatedAt: r.updated_at,
  }));
}
