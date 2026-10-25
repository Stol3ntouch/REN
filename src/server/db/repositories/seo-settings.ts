import type { Db } from '../connection';
import { visibleProductSql } from './products';

/** Чтение данных для SEO-шаблонов и правил индексации (страница «SEO и метаданные»). Только чтение. */
export type SeoSampleProduct = { id: number; slug: string; name: string; brand: string | null; category: string; unitKopecks: number };

type Raw = { id: number; slug: string; name: string; brand: string | null; category: string; price: number; discount: number | null };
const map = (r: Raw): SeoSampleProduct => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  brand: r.brand,
  category: r.category,
  unitKopecks: r.discount !== null && r.discount > 0 && r.discount < r.price ? r.discount : r.price,
});

const SELECT = `SELECT p.id, p.slug, p.name, b.name AS brand, c.name AS category, p.price_kopecks AS price, p.discount_price_kopecks AS discount
  FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id`;

export const seoSettingsRepo = {
  /** Первый видимый на сайте товар: «реальный» товар для предпросмотра шаблона. */
  sampleProduct(db: Db, slug?: string): SeoSampleProduct | null {
    const row = slug
      ? (db.prepare(`${SELECT} WHERE p.slug = ? AND ${visibleProductSql('p')}`).get(slug) as Raw | undefined)
      : (db.prepare(`${SELECT} WHERE ${visibleProductSql('p')} ORDER BY p.in_stock DESC, p.id LIMIT 1`).get() as Raw | undefined);
    return row ? map(row) : null;
  },
  /** Название бренда товара; нет бренда — null. */
  brandOfProduct(db: Db, productId: number): string | null {
    const r = db.prepare('SELECT b.name AS name FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?').get(productId) as { name: string } | undefined;
    return r?.name ?? null;
  },
  /** Видимые товары в категории вместе с подкатегориями. */
  countVisibleInCategory(db: Db, categoryId: number): number {
    const r = db
      .prepare(
        `WITH RECURSIVE tree(id) AS (SELECT id FROM categories WHERE id = ? UNION ALL SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id)
         SELECT COUNT(*) AS n FROM products p WHERE p.category_id IN (SELECT id FROM tree) AND ${visibleProductSql('p')}`,
      )
      .get(categoryId) as { n: number };
    return r.n;
  },
  /** Первая видимая категория с товарами и её название: для предпросмотра шаблона категории. */
  sampleCategory(db: Db): { id: number; slug: string; name: string } | null {
    const r = db
      .prepare(`SELECT c.id, c.slug, c.name FROM categories c WHERE c.effective_hidden = 0 AND EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND ${visibleProductSql('p')}) ORDER BY c.sort, c.id LIMIT 1`)
      .get() as { id: number; slug: string; name: string } | undefined;
    return r ?? null;
  },
};
